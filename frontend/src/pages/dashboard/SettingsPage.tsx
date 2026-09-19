import React, { useState } from 'react'
import { Shield, Bell, User, Key } from 'lucide-react'
import { AppSidebar } from '../../components/layout/AppSidebar'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Toggle } from '../../components/ui/Toggle'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'

const SectionHeading: React.FC<{ icon: React.ReactNode; title: string; subtitle?: string }> = ({ icon, title, subtitle }) => (
  <div className="flex items-start gap-3 mb-6 pb-4 border-b border-[rgba(209,208,208,0.07)]">
    <div className="w-8 h-8 rounded border border-[rgba(209,208,208,0.1)] flex items-center justify-center text-[rgba(209,208,208,0.5)] shrink-0 mt-0.5">
      {icon}
    </div>
    <div>
      <h2 className="text-sm font-medium text-[#D1D0D0]">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-[rgba(209,208,208,0.4)]">{subtitle}</p>}
    </div>
  </div>
)

export const SettingsPage: React.FC = () => {
  const { user } = useAuth()
  const toast = useToast()
  const [emailNotifs, setEmailNotifs] = useState(true)
  const [downloadAlerts, setDownloadAlerts] = useState(true)
  const [failedAuthAlerts, setFailedAuthAlerts] = useState(true)
  const [defaultExpiry, setDefaultExpiry] = useState('7')
  const [defaultMaxDl, setDefaultMaxDl] = useState('')

  const save = () => toast('success', 'Settings saved')

  return (
    <div className="flex min-h-screen bg-[#050505]">
      <AppSidebar />

      <main className="flex-1 min-w-0 lg:pt-0 pt-14">
        <div className="border-b border-[rgba(209,208,208,0.07)] px-6 md:px-8 py-6">
          <h1 className="text-base font-medium text-[#D1D0D0]">Settings</h1>
          <p className="mt-0.5 text-sm text-[rgba(209,208,208,0.4)]">Account and security preferences</p>
        </div>

        <div className="px-6 md:px-8 py-8 max-w-2xl space-y-10">
          {/* Account */}
          <section>
            <SectionHeading icon={<User size={15} />} title="Account" subtitle="Your account information" />
            <div className="space-y-4">
              <Input label="Email" type="email" value={user?.email || ''} readOnly className="opacity-70" />
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={() => toast('info', 'Email change', 'A confirmation will be sent to your new address.')}>
                  Update email
                </Button>
              </div>
            </div>
          </section>

          {/* Password */}
          <section>
            <SectionHeading icon={<Key size={15} />} title="Password" subtitle="Change your account password" />
            <div className="space-y-4">
              <Input label="Current password" type="password" placeholder="••••••••" />
              <Input label="New password" type="password" placeholder="••••••••" />
              <Input label="Confirm new password" type="password" placeholder="••••••••" />
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={() => toast('success', 'Password updated')}>
                  Update password
                </Button>
              </div>
            </div>
          </section>

          {/* Share defaults */}
          <section>
            <SectionHeading icon={<Shield size={15} />} title="Share defaults" subtitle="Default settings for new secure links" />
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Default expiry (days)"
                  type="number"
                  value={defaultExpiry}
                  onChange={e => setDefaultExpiry(e.target.value)}
                  hint="Leave blank for no expiry"
                  min="1"
                />
                <Input
                  label="Default download limit"
                  type="number"
                  value={defaultMaxDl}
                  onChange={e => setDefaultMaxDl(e.target.value)}
                  hint="Leave blank for unlimited"
                  min="1"
                />
              </div>
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={save}>Save defaults</Button>
              </div>
            </div>
          </section>

          {/* Notifications */}
          <section>
            <SectionHeading icon={<Bell size={15} />} title="Notifications" subtitle="Security alerts and activity emails" />
            <div className="space-y-4">
              <Toggle
                checked={emailNotifs}
                onChange={setEmailNotifs}
                label="Activity summary emails"
                description="Receive a daily summary of file access events"
              />
              <Toggle
                checked={downloadAlerts}
                onChange={setDownloadAlerts}
                label="Download alerts"
                description="Get notified when a file is downloaded via a secure link"
              />
              <Toggle
                checked={failedAuthAlerts}
                onChange={setFailedAuthAlerts}
                label="Failed authentication alerts"
                description="Get notified when someone enters an incorrect password"
              />
              <div className="flex justify-end pt-2">
                <Button variant="secondary" size="sm" onClick={save}>Save notifications</Button>
              </div>
            </div>
          </section>

          {/* Danger zone */}
          <section>
            <div className="border border-[rgba(232,123,123,0.15)] rounded-md p-5">
              <h2 className="text-sm font-medium text-[#e87b7b] mb-1">Danger zone</h2>
              <p className="text-xs text-[rgba(209,208,208,0.4)] mb-4">
                Permanently delete your account and all associated data. This cannot be undone.
              </p>
              <Button
                variant="danger"
                size="sm"
                onClick={() => toast('warning', 'Account deletion', 'Please contact support to delete your account.')}
              >
                Delete account
              </Button>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
