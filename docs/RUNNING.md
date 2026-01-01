**Hướng Dẫn Chạy Project & Triển Khai (local / devnet)**

Mô tả ngắn: Hướng dẫn này chỉ dẫn cách build project Anchor, deploy lên local validator (localnet) hoặc Devnet, và cách chạy test.

**Prerequisites**
- **Rust + Anchor CLI**: cài theo hướng dẫn Anchor.
- **Solana CLI**: cài `solana` và cấu hình wallet (mặc định `~/.config/solana/id.json`).
- **Node.js + npm/yarn**: để chạy scripts TypeScript.
- **Docker**: để chạy local validator qua docker-compose (repo đã có `docker-compose.yml`).

**1. Local development (localnet) — khởi động validator**
- Bật local validator bằng Docker Compose:

```powershell
docker compose up -d solana
```

- Kiểm tra validator chạy: `solana cluster-version` (nếu cần) hoặc xem logs docker.

**2. Build chương trình (chỉ khi code thay đổi)**
- Từ thư mục gốc project:

```bash
anchor build
```

Lệnh này sinh file .so tại `target/deploy/charity_fund.so` và IDL trong `target/idl`.

**3. Deploy thủ công (1 lần trên localnet hoặc khi muốn deploy thủ công)**
- Linux / macOS (bash):

```bash
SOLANA_DISABLE_TPU=1 solana program deploy target/deploy/charity_fund.so --use-rpc
```

- Windows PowerShell:

```powershell
$env:SOLANA_DISABLE_TPU="1"
solana program deploy target/deploy/charity_fund.so --use-rpc
```

Ghi chú: `--use-rpc` hữu ích khi deploy qua RPC endpoint thay vì truyền mặc định.

**4. Chạy test**
- Nếu bạn sử dụng local validator đã chạy (không để Anchor tự start), dùng:

Linux / macOS:
```bash
SOLANA_DISABLE_TPU=1 anchor test --skip-local-validator --skip-build --skip-deploy
```

PowerShell:
```powershell
$env:SOLANA_DISABLE_TPU="1"
anchor test --skip-local-validator --skip-build --skip-deploy
```

- Nếu muốn để Anchor quản lý local validator (thông thường cho CI/dev), đơn giản chạy:

```bash
anchor test
```

**5. Triển khai lên Devnet**
- Cấu hình endpoint Devnet và đảm bảo ví có SOL trên devnet:

```bash
solana config set --url https://api.devnet.solana.com
solana airdrop 2 $(solana address) --url https://api.devnet.solana.com
```

- Build rồi deploy (bash):

```bash
anchor build
SOLANA_DISABLE_TPU=1 solana program deploy target/deploy/charity_fund.so --use-rpc
```

- PowerShell tương tự (đặt biến môi trường trước):

```powershell
$env:SOLANA_DISABLE_TPU="1"
solana program deploy target/deploy/charity_fund.so --use-rpc
```

Ghi chú: Trên Devnet cần ví payer có SOL – dùng `solana airdrop` để nạp thử.

**6. File & script tham khảo**
- Script khởi tạo chiến dịch: [scripts/init_campaign.ts](scripts/init_campaign.ts)
- Chạy flow mẫu: [scripts/run_flow.ts](scripts/run_flow.ts)
- Test E2E: [tests/charity_fund.ts](tests/charity_fund.ts)

**7. Lưu ý**
- Nếu thay đổi layout account (struct), nhớ cập nhật `LEN` trong Rust và chạy `anchor build` trước khi deploy.
- Wallet mặc định: `~/.config/solana/id.json`. Đổi bằng `--keypair <PATH>` nếu cần.
- Nếu gặp lỗi timeout khi deploy, thử tăng RPC hoặc dùng biến môi trường `SOLANA_DISABLE_TPU=1` như trên.

---
Program Id: 6Aqi76NwBfy2W7qSHgWptjdoTYWHCig63dcCuZUZBeTn

Signature: 58WuRVcAkwNQnogdpj1jRzWqGWtqihRAeqJ9pfbSNym5zN3XKbJqRbt7YQF8mMzDDHwgaZH29hCvF9qvkY5uUMEB

