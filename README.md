# ledger-app

追記型・監査可能な入出金台帳アプリ。銀行の元帳の考え方を個人向けの小さなWebアプリで再現したもの。

## 設計方針

- **追記のみ**:取引は編集・削除しない。誤りは逆仕訳(取消取引)を新規に追加して相殺する
- **登録前の検証**:残高がマイナスになる取引、0円以下の金額は登録前に拒否する
- **整合性チェック**:保存済みの残高を信用せず、全取引を古い順に再計算して各取引の残高と突き合わせる。不一致があれば取引IDを特定して表示する
- 残高計算と登録は DB トランザクション内で行う

## 構成

- Next.js(App Router)+ TypeScript
- Prisma + SQLite
- `lib/ledger.ts` に台帳ロジックを集約

| API | 内容 |
|---|---|
| `GET /api/transactions` | 取引一覧 |
| `POST /api/transactions` | 入金/出金の登録 `{ type, amount, description }` |
| `POST /api/transactions/:id/reverse` | 取消取引の追加 |
| `GET /api/integrity` | 整合性チェック結果 |

## セットアップ

```bash
npm install
echo 'DATABASE_URL="file:./dev.db"' > .env
npx prisma migrate dev
npm run dev
```

http://localhost:3000 を開く。
