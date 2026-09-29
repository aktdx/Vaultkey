using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace VaultKey.SecureViewer;

internal sealed class SecureViewerForm : Form
{
    private const uint WdaExcludeFromCapture = 0x00000011;
    private const int WmSize = 0x0005;
    private const int WmActivate = 0x0006;
    private const int WmWindowPosChanged = 0x0047;
    private const int WmDisplayChange = 0x007E;
    private const int WmDpiChanged = 0x02E0;
    private readonly ViewerLaunchRequest _request;
    private readonly Label _status = new()
    {
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleCenter,
        Font = new Font("Segoe UI", 12),
        ForeColor = Color.White,
        BackColor = Color.FromArgb(16, 21, 18),
        Text = "Establishing protected display…",
        Padding = new Padding(32),
    };
    private WebView2? _webView;
    private SecureHandoffServer? _handoffServer;
    private byte[]? _pendingKey;
    private bool _captureProtectionEnabled;
    private bool _viewerReady;
    private bool _failed;

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint affinity);

    public SecureViewerForm(ViewerLaunchRequest request)
    {
        _request = request;
        Text = "VaultKey Secure Viewer";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(720, 520);
        Size = new Size(1120, 820);
        BackColor = Color.FromArgb(16, 21, 18);
        Controls.Add(_status);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        if (!_failed && !ApplyCaptureProtection()) FailClosed();
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (_failed || !ApplyCaptureProtection())
        {
            FailClosed();
            return;
        }

        try
        {
            var assetsPath = Path.Combine(AppContext.BaseDirectory, "wwwroot");
            if (!File.Exists(Path.Combine(assetsPath, "index.html")))
                throw new InvalidOperationException("The secure viewer web assets are unavailable.");

            _handoffServer = new SecureHandoffServer(_request, OnKeyReceived);
            await _handoffServer.StartAsync();
            await InitializeWebViewAsync(assetsPath);
        }
        catch
        {
            FailClosed();
        }
    }

    private async Task InitializeWebViewAsync(string assetsPath)
    {
        var browser = new WebView2
        {
            Dock = DockStyle.Fill,
            AllowExternalDrop = false,
            Visible = false,
        };
        _webView = browser;
        Controls.Add(browser);
        browser.BringToFront();
        await browser.EnsureCoreWebView2Async();

        if (!_captureProtectionEnabled || _failed)
            throw new InvalidOperationException("Capture protection is unavailable.");

        var core = browser.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.SetVirtualHostNameToFolderMapping(
            "vaultkey.local",
            assetsPath,
            CoreWebView2HostResourceAccessKind.Allow);
        core.AddWebResourceRequestedFilter(
            "https://vaultkey.local/secure-viewer*",
            CoreWebView2WebResourceContext.Document);
        core.WebResourceRequested += ServeReactRoute;
        core.WebMessageReceived += HandleWebMessage;

        browser.Visible = true;
        core.Navigate("https://vaultkey.local/secure-viewer");
    }

    private void ServeReactRoute(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri) || uri.AbsolutePath != "/secure-viewer")
            return;
        var path = Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html");
        var stream = File.OpenRead(path);
        e.Response = _webView!.CoreWebView2.Environment.CreateWebResourceResponse(
            stream,
            200,
            "OK",
            "Content-Type: text/html; charset=utf-8");
    }

    private void HandleWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            if (message.RootElement.GetProperty("type").GetString() != "viewer-ready") return;
            if (!_captureProtectionEnabled || _failed)
            {
                PostMessage(new { type = "capture-protection-failed" });
                return;
            }

            _viewerReady = true;
            PostMessage(new
            {
                type = "viewer-ready",
                @protected = true,
                shareId = _request.ShareId,
            });
            if (_pendingKey is not null)
            {
                var key = _pendingKey;
                _pendingKey = null;
                PostKey(key);
            }
        }
        catch (JsonException)
        {
            FailClosed();
        }
        catch (KeyNotFoundException)
        {
            FailClosed();
        }
    }

    private void OnKeyReceived(byte[] key)
    {
        if (IsDisposed || !IsHandleCreated)
        {
            CryptographicOperations.ZeroMemory(key);
            return;
        }
        BeginInvoke(() =>
        {
            if (_failed || !_captureProtectionEnabled)
            {
                CryptographicOperations.ZeroMemory(key);
                return;
            }
            if (!_viewerReady)
            {
                if (_pendingKey is not null) CryptographicOperations.ZeroMemory(_pendingKey);
                _pendingKey = key;
                return;
            }
            PostKey(key);
        });
    }

    private void PostKey(byte[] key)
    {
        try
        {
            if (!_captureProtectionEnabled || _failed || _webView?.CoreWebView2 is null)
                return;
            var keyBase64 = Convert.ToBase64String(key).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            PostMessage(new { type = "handoff-key", shareId = _request.ShareId, keyBase64 });
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
        }
    }

    private void PostMessage(object message)
    {
        if (_webView?.CoreWebView2 is null) return;
        _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message));
    }

    protected override void WndProc(ref Message message)
    {
        base.WndProc(ref message);
        if (message.Msg is WmSize or WmActivate or WmWindowPosChanged or WmDisplayChange or WmDpiChanged)
            VerifyCaptureProtection();
    }

    protected override void OnLocationChanged(EventArgs e)
    {
        base.OnLocationChanged(e);
        VerifyCaptureProtection();
    }

    protected override void OnHandleDestroyed(EventArgs e)
    {
        if (!Disposing && _captureProtectionEnabled && !_failed && _webView is not null)
            FailClosed();
        base.OnHandleDestroyed(e);
    }

    private bool ApplyCaptureProtection()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041) || !IsHandleCreated || IsDisposed)
            return false;
        var applied = SetWindowDisplayAffinity(Handle, WdaExcludeFromCapture);
        _captureProtectionEnabled = applied;
        return applied;
    }

    private void VerifyCaptureProtection()
    {
        if (_failed || !IsHandleCreated || IsDisposed || !Visible) return;
        if (!ApplyCaptureProtection()) FailClosed();
    }

    private void FailClosed()
    {
        if (_failed) return;
        _failed = true;
        _captureProtectionEnabled = false;
        _viewerReady = false;
        if (_pendingKey is not null)
        {
            CryptographicOperations.ZeroMemory(_pendingKey);
            _pendingKey = null;
        }
        if (_webView?.CoreWebView2 is not null)
        {
            try
            {
                _webView.CoreWebView2.NavigateToString(
                    "<!doctype html><html><meta charset='utf-8'><body style='background:#101512;color:#fff;font:16px Segoe UI;padding:48px'>" +
                    "Secure display protection could not be maintained. The document has been hidden.</body></html>");
            }
            catch (InvalidOperationException) { }
        }
        _status.Text = "Secure display protection could not be enabled. The document will not be displayed.";
        _status.Visible = true;
        _status.BringToFront();
        _webView?.Hide();
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _handoffServer?.Dispose();
        if (_pendingKey is not null) CryptographicOperations.ZeroMemory(_pendingKey);
        _webView?.Dispose();
        base.OnFormClosed(e);
    }
}
