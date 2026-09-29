using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace VaultKey.SecureViewer;

internal sealed class SecureHandoffServer : IDisposable
{
    private const int Port = 41739;
    private const int MaximumHeaderBytes = 16 * 1024;
    private const int MaximumBodyBytes = 8 * 1024;
    private static readonly HashSet<string> AllowedOrigins = BuildAllowedOrigins();
    private readonly ViewerLaunchRequest _request;
    private readonly RSA _rsa = RSA.Create(2048);
    private readonly TcpListener _listener = new(IPAddress.Loopback, Port);
    private readonly Action<byte[]> _onKeyReceived;
    private int _accepted;
    private CancellationTokenSource? _shutdown;

    public SecureHandoffServer(ViewerLaunchRequest request, Action<byte[]> onKeyReceived)
    {
        _request = request;
        _onKeyReceived = onKeyReceived;
    }

    public Task StartAsync()
    {
        _listener.Start(8);
        _shutdown = new CancellationTokenSource();
        _ = AcceptLoopAsync(_shutdown.Token);
        return Task.CompletedTask;
    }

    private async Task AcceptLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var client = await _listener.AcceptTcpClientAsync(cancellationToken);
                _ = ProcessClientAsync(client, cancellationToken);
            }
        }
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
    }

    private async Task ProcessClientAsync(TcpClient client, CancellationToken cancellationToken)
    {
        using (client)
        {
            client.ReceiveTimeout = 5000;
            client.SendTimeout = 5000;
            var stream = client.GetStream();
            try
            {
                var (requestLine, headers, body) = await ReadRequestAsync(stream, cancellationToken);
                var parts = requestLine.Split(' ', 3);
                if (parts.Length != 3 || !headers.TryGetValue("Origin", out var origin) || !AllowedOrigins.Contains(origin))
                {
                    await WriteResponseAsync(stream, 403, "Forbidden", "", origin: null);
                    return;
                }

                if (parts[0] == "OPTIONS")
                {
                    await WriteResponseAsync(stream, 204, "No Content", "", origin);
                    return;
                }

                if (!Uri.TryCreate("http://127.0.0.1" + parts[1], UriKind.Absolute, out var uri))
                {
                    await WriteResponseAsync(stream, 400, "Bad Request", "", origin);
                    return;
                }

                if (parts[0] == "GET" && uri.AbsolutePath == "/challenge")
                {
                    var query = ParseQuery(uri.Query);
                    if (Volatile.Read(ref _accepted) != 0 ||
                        query.GetValueOrDefault("share_id") != _request.ShareId ||
                        !FixedTimeNonceMatches(query.GetValueOrDefault("nonce")))
                    {
                        await WriteResponseAsync(stream, 404, "Not Found", "", origin);
                        return;
                    }

                    var publicKey = Base64Url(_rsa.ExportSubjectPublicKeyInfo());
                    var responseBody = JsonSerializer.Serialize(new { public_key = publicKey });
                    await WriteResponseAsync(stream, 200, "OK", responseBody, origin);
                    return;
                }

                if (parts[0] == "POST" && uri.AbsolutePath == "/handoff")
                {
                    if (Volatile.Read(ref _accepted) != 0)
                    {
                        await WriteResponseAsync(stream, 409, "Conflict", "", origin);
                        return;
                    }

                    using var document = JsonDocument.Parse(body);
                    var root = document.RootElement;
                    var shareId = root.GetProperty("share_id").GetString();
                    var nonce = root.GetProperty("nonce").GetString();
                    var encryptedKey = root.GetProperty("encrypted_key").GetString();
                    if (shareId != _request.ShareId || !FixedTimeNonceMatches(nonce) || string.IsNullOrEmpty(encryptedKey))
                    {
                        await WriteResponseAsync(stream, 403, "Forbidden", "", origin);
                        return;
                    }

                    var encryptedBytes = DecodeBase64Url(encryptedKey);
                    byte[] keyBytes;
                    try
                    {
                        keyBytes = _rsa.Decrypt(encryptedBytes, RSAEncryptionPadding.OaepSHA256);
                    }
                    finally
                    {
                        CryptographicOperations.ZeroMemory(encryptedBytes);
                    }

                    if (keyBytes.Length != 32 || Interlocked.CompareExchange(ref _accepted, 1, 0) != 0)
                    {
                        CryptographicOperations.ZeroMemory(keyBytes);
                        await WriteResponseAsync(stream, 400, "Bad Request", "", origin);
                        return;
                    }

                    _onKeyReceived(keyBytes);
                    await WriteResponseAsync(stream, 200, "OK", "{\"accepted\":true}", origin);
                    return;
                }

                await WriteResponseAsync(stream, 404, "Not Found", "", origin);
            }
            catch (Exception exception) when (exception is IOException or SocketException or JsonException or FormatException or CryptographicException or OperationCanceledException or KeyNotFoundException or InvalidOperationException)
            {
                try { await WriteResponseAsync(stream, 400, "Bad Request", "", origin: null); }
                catch (IOException) { }
            }
        }
    }

    private static async Task<(string RequestLine, Dictionary<string, string> Headers, string Body)> ReadRequestAsync(
        NetworkStream stream,
        CancellationToken cancellationToken)
    {
        using var headerBuffer = new MemoryStream();
        var oneByte = new byte[1];
        var matched = 0;
        var terminator = new byte[] { 13, 10, 13, 10 };
        while (headerBuffer.Length < MaximumHeaderBytes)
        {
            var read = await stream.ReadAsync(oneByte.AsMemory(), cancellationToken);
            if (read == 0) throw new IOException("Connection closed before headers completed.");
            headerBuffer.WriteByte(oneByte[0]);
            matched = oneByte[0] == terminator[matched] ? matched + 1 : oneByte[0] == 13 ? 1 : 0;
            if (matched == terminator.Length) break;
        }
        if (matched != terminator.Length) throw new IOException("HTTP headers exceeded the limit.");

        var headerText = Encoding.ASCII.GetString(headerBuffer.ToArray());
        var lines = headerText.Split("\r\n", StringSplitOptions.None);
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines.Skip(1))
        {
            if (line.Length == 0) break;
            var separator = line.IndexOf(':');
            if (separator > 0) headers[line[..separator].Trim()] = line[(separator + 1)..].Trim();
        }

        var contentLength = 0;
        if (headers.TryGetValue("Content-Length", out var lengthValue) && !int.TryParse(lengthValue, out contentLength))
            throw new IOException("Invalid content length.");
        if (contentLength < 0 || contentLength > MaximumBodyBytes || headers.ContainsKey("Transfer-Encoding"))
            throw new IOException("HTTP body exceeded the limit.");

        var bodyBytes = new byte[contentLength];
        if (contentLength > 0) await stream.ReadExactlyAsync(bodyBytes, cancellationToken);
        return (lines[0], headers, Encoding.UTF8.GetString(bodyBytes));
    }

    private static async Task WriteResponseAsync(NetworkStream stream, int status, string reason, string body, string? origin)
    {
        var bodyBytes = Encoding.UTF8.GetBytes(body);
        var headers = new StringBuilder()
            .Append($"HTTP/1.1 {status} {reason}\r\n")
            .Append("Connection: close\r\n")
            .Append($"Content-Length: {bodyBytes.Length}\r\n")
            .Append("Content-Type: application/json; charset=utf-8\r\n");
        if (origin is not null)
        {
            headers.Append($"Access-Control-Allow-Origin: {origin}\r\n")
                .Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
                .Append("Access-Control-Allow-Headers: content-type\r\n")
                .Append("Access-Control-Allow-Private-Network: true\r\n")
                .Append("Access-Control-Max-Age: 60\r\n")
                .Append("Vary: Origin\r\n");
        }
        headers.Append("\r\n");
        var headerBytes = Encoding.ASCII.GetBytes(headers.ToString());
        await stream.WriteAsync(headerBytes);
        await stream.WriteAsync(bodyBytes);
        await stream.FlushAsync();
    }

    private bool FixedTimeNonceMatches(string? candidate)
    {
        if (candidate is null) return false;
        var expected = Encoding.ASCII.GetBytes(_request.Nonce);
        var actual = Encoding.ASCII.GetBytes(candidate);
        return actual.Length == expected.Length && CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        return query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .Where(parts => parts.Length == 2)
            .ToDictionary(parts => Uri.UnescapeDataString(parts[0]), parts => Uri.UnescapeDataString(parts[1]), StringComparer.Ordinal);
    }

    private static HashSet<string> BuildAllowedOrigins()
    {
        var configured = Environment.GetEnvironmentVariable("VAULTKEY_VIEWER_ORIGINS") ??
            "https://vaultkey-chi.vercel.app;http://localhost:5173;http://127.0.0.1:5173";
        return configured.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] DecodeBase64Url(string value)
    {
        var base64 = value.Replace('-', '+').Replace('_', '/');
        base64 = base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '=');
        return Convert.FromBase64String(base64);
    }

    public void Dispose()
    {
        _shutdown?.Cancel();
        _listener.Stop();
        _shutdown?.Dispose();
        _rsa.Dispose();
    }
}
