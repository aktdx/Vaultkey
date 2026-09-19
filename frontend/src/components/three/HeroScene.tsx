import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export default function HeroScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer | null
    scene: THREE.Scene | null
    camera: THREE.PerspectiveCamera | null
    frame: number
    particles: THREE.Points | null
    ring1: THREE.Mesh | null
    ring2: THREE.Mesh | null
    ring3: THREE.Mesh | null
    coreGeo: THREE.Mesh | null
    lines: THREE.LineSegments | null
    time: number
  }>({
    renderer: null, scene: null, camera: null, frame: 0,
    particles: null, ring1: null, ring2: null, ring3: null,
    coreGeo: null, lines: null, time: 0
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // ── Renderer ──────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    renderer.setClearColor(0x000000, 0)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 200)
    camera.position.set(0, 0, 18)

    stateRef.current.renderer = renderer
    stateRef.current.scene = scene
    stateRef.current.camera = camera

    // ── Particles ─────────────────────────────────────────────────────────
    const particleCount = 800
    const positions = new Float32Array(particleCount * 3)
    const velocities = new Float32Array(particleCount * 3)
    for (let i = 0; i < particleCount; i++) {
      const r = 6 + Math.random() * 14
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      positions[i * 3 + 2] = r * Math.cos(phi)
      velocities[i * 3] = (Math.random() - 0.5) * 0.005
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.005
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.005
    }
    const partGeo = new THREE.BufferGeometry()
    partGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const partMat = new THREE.PointsMaterial({
      color: 0xD1D0D0,
      size: 0.04,
      transparent: true,
      opacity: 0.35,
      sizeAttenuation: true,
    })
    const particles = new THREE.Points(partGeo, partMat)
    scene.add(particles)
    stateRef.current.particles = particles

    // ── Rings ─────────────────────────────────────────────────────────────
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0xD1D0D0, wireframe: true, transparent: true, opacity: 0.06,
    })
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: 0x988686, wireframe: true, transparent: true, opacity: 0.05,
    })
    const ringMat3 = new THREE.MeshBasicMaterial({
      color: 0x5C4E4E, wireframe: true, transparent: true, opacity: 0.08,
    })
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(6, 0.015, 2, 80), ringMat1)
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.012, 2, 64), ringMat2)
    const ring3 = new THREE.Mesh(new THREE.TorusGeometry(8.5, 0.01, 2, 96), ringMat3)
    ring1.rotation.x = Math.PI / 4
    ring2.rotation.x = -Math.PI / 6
    ring2.rotation.z = Math.PI / 5
    ring3.rotation.y = Math.PI / 3
    scene.add(ring1, ring2, ring3)
    stateRef.current.ring1 = ring1
    stateRef.current.ring2 = ring2
    stateRef.current.ring3 = ring3

    // ── Core Geometry ─────────────────────────────────────────────────────
    const icosaGeo = new THREE.IcosahedronGeometry(2, 1)
    const icoMat = new THREE.MeshBasicMaterial({
      color: 0xD1D0D0, wireframe: true, transparent: true, opacity: 0.12,
    })
    const coreGeo = new THREE.Mesh(icosaGeo, icoMat)
    scene.add(coreGeo)
    stateRef.current.coreGeo = coreGeo

    // ── Connection Lines ───────────────────────────────────────────────────
    const linePositions: number[] = []
    const nodePts: THREE.Vector3[] = []
    for (let i = 0; i < 16; i++) {
      const r = 4 + Math.random() * 4
      const t = Math.random() * Math.PI * 2
      const p = Math.random() * Math.PI
      nodePts.push(new THREE.Vector3(
        r * Math.sin(p) * Math.cos(t),
        r * Math.sin(p) * Math.sin(t),
        r * Math.cos(p)
      ))
    }
    // Connect nearby nodes
    for (let i = 0; i < nodePts.length; i++) {
      for (let j = i + 1; j < nodePts.length; j++) {
        if (nodePts[i].distanceTo(nodePts[j]) < 5) {
          linePositions.push(nodePts[i].x, nodePts[i].y, nodePts[i].z)
          linePositions.push(nodePts[j].x, nodePts[j].y, nodePts[j].z)
        }
      }
    }
    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePositions), 3))
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xD1D0D0, transparent: true, opacity: 0.08,
    })
    const lines = new THREE.LineSegments(lineGeo, lineMat)
    scene.add(lines)
    stateRef.current.lines = lines

    // ── Animation loop ─────────────────────────────────────────────────────
    const animate = () => {
      const s = stateRef.current
      s.time += 0.006
      s.frame = requestAnimationFrame(animate)

      // Scroll-driven depth
      const scrollFactor = (window.scrollY || 0) / (document.body.scrollHeight - window.innerHeight || 1)
      camera.position.z = 18 - scrollFactor * 6
      camera.position.y = -scrollFactor * 3

      // Core rotation
      if (s.coreGeo) {
        s.coreGeo.rotation.x = s.time * 0.3
        s.coreGeo.rotation.y = s.time * 0.4
      }
      // Rings
      if (s.ring1) s.ring1.rotation.z = s.time * 0.12
      if (s.ring2) s.ring2.rotation.y = s.time * 0.18
      if (s.ring3) s.ring3.rotation.x = s.time * 0.08
      // Particles drift
      if (s.particles) {
        s.particles.rotation.y = s.time * 0.015
        s.particles.rotation.x = Math.sin(s.time * 0.08) * 0.05
      }
      // Lines slow drift
      if (s.lines) s.lines.rotation.y = -s.time * 0.02

      renderer.render(scene, camera)
    }
    animate()

    // ── Resize ─────────────────────────────────────────────────────────────
    const onResize = () => {
      if (!canvas) return
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(stateRef.current.frame)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      id="hero-canvas"
      aria-hidden="true"
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  )
}
