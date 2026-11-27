# 部署到 Cloudflare（Workers + R2）

這個專案在 Cloudflare 上的架構：

| 部分 | 放在哪裡 | 說明 |
| --- | --- | --- |
| 前端網頁（`dist/`） | Worker 靜態資源 | 免費、不計流量 |
| 搜尋索引、頁面位置索引 | 打包進 Worker | Worker 啟動時解析一次，之後每次請求只花 1–5 ms CPU |
| JSONL 語料分片、同步覆寫頁 | R2 | `/api/page` 用 byte-range 只讀取需要的那一頁 |
| `llms-full.txt`、`llms/<章節>.txt` 完整包 | R2 | 事先建好，直接串流，R2 對外流量免費 |
| 每日同步 doc.esri.com | GitHub Actions | 每天台灣時間 03:30 執行，跑完自動重新部署 |

Cloudflare 上的 API 是**唯讀**的：`/api/sync/*` 的寫入操作會回 501，改由 GitHub Actions 同步。

## 一次性設定（約 10 分鐘）

1. **建立 R2 bucket**
   Cloudflare 後台 → R2 → 建立 bucket，名稱填 `arcgis-pro-guidance`（第一次使用 R2 可能需要綁定付款方式；免費額度內不會收費）。

2. **建立 API Token**
   Cloudflare 後台 → 右上角頭像 → My Profile → API Tokens → Create Token → 使用「Edit Cloudflare Workers」範本，
   並確認權限包含：
   - Account → Workers Scripts → Edit
   - Account → Workers R2 Storage → Edit

3. **找到 Account ID**
   Cloudflare 後台首頁右側欄，或 Workers & Pages 頁面右側的「Account ID」。

4. **把兩個值存到 GitHub Secrets**
   GitHub repo → Settings → Secrets and variables → Actions → New repository secret：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

5. **第一次部署**
   GitHub repo → Actions → 「Sync Esri docs and deploy to Cloudflare」→ Run workflow。
   完成後網址會是 `https://arcgis-pro-guidance.<你的子網域>.workers.dev`。

6. （可選）綁定自訂網域後，把 `wrangler.jsonc` 裡的 `PUBLIC_BASE_URL` 設成該網域。

7. 確認 Cloudflare 版本運作正常後，就可以到 GCP 刪除 Cloud Run 服務 `arcgis-pro-guidance`。

## 本機開發

```bash
npm install
npm run dev                   # 原本的 Node/Express 伺服器（含同步管理功能）

npm run build:cf              # vite build + 產生 Worker 索引與 R2 物件到 .cloudflare/
npm run upload:r2 -- --local  # 把 R2 物件放進本機模擬的 bucket
npx wrangler dev              # 在 http://localhost:8787 測試 Worker
```

手動部署（需要先 `export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...`）：

```bash
npm run deploy:cf
```

## 免費方案限制與對應

- **每次請求 10 ms CPU**：索引在 Worker 啟動時就解析好，搜尋只花 1–5 ms。
- **每次請求 50 個子請求**：帶 `?q=` 或 `?limit=` 的動態 `llms-full.txt` 最多輸出 40 頁；不帶參數時直接串流 R2 上的完整包。
- **每天 10 萬次請求**：超過當天會回錯誤，隔天重置，不會產生費用。
- **R2**：每月 10 GB 儲存、100 萬次寫入、1000 萬次讀取免費；對外流量永遠免費。本專案約使用 0.3 GB。
