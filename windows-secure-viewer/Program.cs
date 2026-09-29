using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace VaultKey.SecureViewer;

internal sealed record ViewerLaunchRequest(string ShareId, string Nonce)
{
    private static readonly Regex NoncePattern = new("^[A-Za-z0-9_-]{43}$", RegexOptions.Compiled);

    public static ViewerLaunchRequest? FromArguments(string[] args)
    {
        foreach (var argument in args)
        {
            if (!Uri.TryCreate(argument, UriKind.Absolute, out var uri) ||
                !uri.Scheme.Equals("vaultkey", StringComparison.OrdinalIgnoreCase) ||
                !uri.Host.Equals("share", StringComparison.OrdinalIgnoreCase))
                continue;

            var shareId = uri.AbsolutePath.Trim('/');
            var nonce = uri.Query.TrimStart('?')
                .Split('&', StringSplitOptions.RemoveEmptyEntries)
                .Select(part => part.Split('=', 2))
                .Where(parts => parts.Length == 2 && Uri.UnescapeDataString(parts[0]) == "nonce")
                .Select(parts => Uri.UnescapeDataString(parts[1]))
                .FirstOrDefault();

            if (!Guid.TryParseExact(shareId, "D", out var parsedShareId) ||
                nonce is null || !NoncePattern.IsMatch(nonce))
                return null;

            try
            {
                var nonceBytes = DecodeBase64Url(nonce);
                if (nonceBytes.Length != 32) return null;
                CryptographicOperations.ZeroMemory(nonceBytes);
            }
            catch (FormatException)
            {
                return null;
            }

            return new ViewerLaunchRequest(parsedShareId.ToString("D"), nonce);
        }

        return null;
    }

    private static byte[] DecodeBase64Url(string value)
    {
        var base64 = value.Replace('-', '+').Replace('_', '/');
        base64 = base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '=');
        return Convert.FromBase64String(base64);
    }
}

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var request = ViewerLaunchRequest.FromArguments(args);
        if (request is null)
        {
            MessageBox.Show(
                "The Secure Viewer launch request is invalid. No document was opened.",
                "VaultKey Secure Viewer",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        Application.Run(new SecureViewerForm(request));
    }
}
