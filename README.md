# ArcGIS Pro Docs AI Gateway

**[開啟正式站](https://arcgis-pro-guidance.regent0504.workers.dev/)** · [AI 文件索引](https://arcgis-pro-guidance.regent0504.workers.dev/llms.txt) · [OpenAPI 3.1](https://arcgis-pro-guidance.regent0504.workers.dev/api/openapi.json)

這個專案將 Esri 的 ArcGIS Pro 說明文件整理成可用繁體中文或英文搜尋的知識庫，並提供 Markdown 與 JSON，方便 AI 助理、IDE 或腳本擷取單篇文件。內容涵蓋入門、應用程式說明、地理處理工具、ArcPy 與 ArcGIS Pro SDK for .NET。

## 從哪裡開始

- **找工具或解決錯誤**。在正式站開啟「文件知識庫檢索」，輸入 `緩衝區`、`Buffer` 或錯誤碼 `000732`。點選結果即可查看結構化卡片、Markdown 或 JSON。找 .NET 類別或成員時，切換至「.NET SDK 成員索引」。
- **給 AI 查資料**。將 `llms.txt` 網址提供給支援讀取網址的 AI 工具。先依關鍵字搜尋文件，再用結果的 `path` 讀取單頁。回答時可引用文件回傳的 `sourceEnUrl` 與 `contentVersion`，方便核對 Esri 原文和版本。
- **批次讀取文件**。從 `llms-full.txt` 取得全文，或使用下列章節連結與篩選參數縮小範圍。

## 文件與 API 入口

以下正式站端點可直接讀取，無須登入。也可以在站內「API 測試台」修改參數、查看回應及複製 cURL。

| 入口 | 用途 |
| --- | --- |
| [`/llms.txt`](https://arcgis-pro-guidance.regent0504.workers.dev/llms.txt) | AI 文件索引，包含章節、代表性文件與 API 入口。 |
| [`/llms-full.txt`](https://arcgis-pro-guidance.regent0504.workers.dev/llms-full.txt) | 全量 Markdown。可用 `chapter` 選章節，或用 `q`、`limit` 取得篩選版本。正式站的篩選版本每次最多 40 頁。 |
| [`/api/search`](https://arcgis-pro-guidance.regent0504.workers.dev/api/search?q=Buffer&limit=5) | 用 `q` 搜尋中英文關鍵字或錯誤碼。支援 `chapter`、`limit` 及 `offset`。 |
| [`/api/page`](https://arcgis-pro-guidance.regent0504.workers.dev/api/page?path=tool-reference%2Fanalysis%2Fbuffer.html&format=markdown) | 使用搜尋結果的 `path` 取得單頁。預設回傳 JSON，`format=markdown` 回傳 Markdown。 |
| [`/api/sdk`](https://arcgis-pro-guidance.regent0504.workers.dev/api/sdk?q=EditOperation&limit=5) | 按類別、方法或屬性搜尋 ArcGIS Pro SDK for .NET，取得對應的官方文件連結。 |
| [`/api/chapters`](https://arcgis-pro-guidance.regent0504.workers.dev/api/chapters) · [`/api/stats`](https://arcgis-pro-guidance.regent0504.workers.dev/api/stats) | 查詢章節、文件數量與語料統計。 |
| [`/api/openapi.json`](https://arcgis-pro-guidance.regent0504.workers.dev/api/openapi.json) | OpenAPI 3.1 規格，供支援 OpenAPI 的工具讀取。 |

**分章節全文** · [入門指南](https://arcgis-pro-guidance.regent0504.workers.dev/llms/get-started.txt) · [應用程式說明](https://arcgis-pro-guidance.regent0504.workers.dev/llms/help.txt) · [地理處理工具參考](https://arcgis-pro-guidance.regent0504.workers.dev/llms/tool-reference.txt) · [ArcPy](https://arcgis-pro-guidance.regent0504.workers.dev/llms/arcpy.txt) · [.NET SDK](https://arcgis-pro-guidance.regent0504.workers.dev/llms/sdk.txt)

### 範例：查找 Buffer 工具

先查詢 `緩衝區`，從回傳的 `items` 確認目標文件路徑。再以該路徑取得文件，查看工具用法、參數與範例。

```bash
curl --fail --silent --show-error --get \
  'https://arcgis-pro-guidance.regent0504.workers.dev/api/search' \
  --data-urlencode 'q=緩衝區' \
  --data-urlencode 'chapter=tool-reference' \
  --data-urlencode 'limit=5'

curl --fail --silent --show-error --get \
  'https://arcgis-pro-guidance.regent0504.workers.dev/api/page' \
  --data-urlencode 'path=tool-reference/analysis/buffer.html' \
  --data-urlencode 'format=markdown'
```

## 同步與部署

正式站由 Cloudflare Workers 提供介面與 API，Cloudflare R2 儲存語料及全文匯出。GitHub Actions 預定**每天台灣時間 03:30** 巡檢 Esri 文件並部署，推送至 `main` 也會觸發建置與部署。

正式站的「自動同步引擎」頁面供唯讀查閱，可查看最近一次排程結果、同步紀錄與覆寫清單。具備儲存庫權限的維護者可在 GitHub Actions 手動觸發工作流程。 [GitHub Actions 執行紀錄](https://github.com/regent90/arcgis-pro-guidance/actions/workflows/sync-and-deploy.yml) · [Cloudflare 部署設定](DEPLOY-CLOUDFLARE.md)

## 本機開發

建議使用 Node.js 22，與 GitHub Actions 一致。

```bash
git clone https://github.com/regent90/arcgis-pro-guidance.git
cd arcgis-pro-guidance
npm ci
npm run dev
```

開啟 [http://localhost:3000](http://localhost:3000)。提交前可執行 `npm run lint` 檢查型別，以及 `npm test` 執行測試。若要在本機預覽 Cloudflare Worker，請參考部署說明中的 R2 與 Wrangler 步驟。 [部署與本機預覽說明](DEPLOY-CLOUDFLARE.md)

## 文件來源

語料整理自 Esri ArcGIS Pro 官方說明。各篇文件的英文原文連結和版本資訊可用來核對參數、授權需求與版本差異。 [Esri ArcGIS Pro 官方文件](https://doc.esri.com/en/arcgis-pro/latest/)
