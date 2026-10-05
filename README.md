# ledger-app

追記型・監査可能な入出金台帳アプリ。銀行の元帳の考え方を、複数口座と口座間振替を持つ小さなWebアプリで再現したもの。

## 設計方針

- **追記のみ**:取引は編集・削除しない。誤りは逆仕訳(取消取引)を新規に追加して相殺する
- **振替は2本で1組**:出金と入金を同じDBトランザクションで書く。どちらかが失敗すれば両方なかったことになる。取消も2本まとめて行う
- **登録前の検証**:残高がマイナスになる取引、0円以下や小数の金額は登録前に拒否する
- **同時実行への備え**
  - 残高を読む前に対象口座の書き込みロックを取る。複数口座はID順にロックし、逆向きの振替同士のデッドロックを防ぐ
  - 口座内の連番 `(accountId, seq)` に一意制約をかけ、同じ残高を元にした二重書き込みをDBが拒否する。競合時は最新の状態から再試行する
  - SQLite は同時に1本しか書き込めないため、Prisma の接続を1本にして順番待ちさせる
- **整合性チェック**:保存済みの値を信用せず、全取引から次を検証する
  - 口座ごとの連番が欠番なく続いている(途中の行の削除を検知)
  - 古い順に再計算した残高が各行の残高と一致する(残高・金額の改ざんを検知)
  - 振替が「同額の出金1本と入金1本・別口座」で構成されている
  - 取消取引が元の取引と同じ口座・同額・逆向きである

### わかっている限界

- 最新の取引を丸ごと削除された場合は、連番も残高も前の行までは正しいため検知できない
- 整合性チェックは全件を読み直すため、取引数に比例して遅くなる

## 構成

- Next.js(App Router)+ TypeScript
- Prisma + SQLite
- Vitest(テスト用の SQLite DB に対して実行。モックは使わない)
- `lib/ledger.ts` に台帳ロジックを集約

| API | 内容 |
|---|---|
| `GET /api/accounts` | 口座と残高の一覧 |
| `POST /api/accounts` | 口座の作成 `{ name }` |
| `GET /api/transactions` | 取引一覧 |
| `POST /api/transactions` | 入金/出金の登録 `{ accountId, type, amount, description }` |
| `POST /api/transfers` | 振替 `{ fromAccountId, toAccountId, amount, description }` |
| `POST /api/transactions/:id/reverse` | 取消取引の追加(振替は2本まとめて) |
| `GET /api/integrity` | 整合性チェック結果 |

## セットアップ

```bash
npm install
echo 'DATABASE_URL="file:./dev.db"' > .env
npx prisma migrate dev
npm run dev
```

http://localhost:3000 を開く。

## テスト

```bash
npm test
```

入出金・振替・取消に加え、10件同時の出金で残高がマイナスにならないこと、DBを直接書き換えたときに整合性チェックが検知することを確かめている。
