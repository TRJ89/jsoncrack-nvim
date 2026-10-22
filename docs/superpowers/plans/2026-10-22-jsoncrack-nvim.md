# JSON Crack Preview for Neovim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LazyVimから保存済みJSON/YAMLを既定ブラウザで表示し、保存時更新と確実な終了処理を備えたMVPを作る。

**Architecture:** Luaが対象バッファとPython子プロセスを管理する。Python標準ライブラリのHTTPサーバーが固定した1ファイルと同梱アセットを配信し、React UIが500 ms間隔で取得・検証してjsoncrack-reactに渡す。

**Tech Stack:** Neovim Lua、Python標準ライブラリ、React/TypeScript、jsoncrack-react、jsonc-parser、yaml 2、Vite。開発用テストはplenary.nvim、Python unittest、Vitest、Playwright。

**Spec:** [承認済み機能・技術仕様書](../specs/2026-10-22-jsoncrack-nvim-design.md)。実装者は本計画と仕様書の両方を読む。

作成日：2026-10-22。状態：実装計画作成済み、実装未着手。チェックボックスは今後の実施記録であり、本書作成時の検証結果ではない。

## Global Constraints

- 対象はローカルLinux＋LazyVim。Neovimは最低0.11、Pythonは最低3.10。LazyVim自体が要求する版も満たす。
- 起動先はOSの既定ブラウザ。FirefoxおよびChromium安定版で検証し、採用・検証版を記録する。
- 1 Neovimプロセスにつき1セッション。保存済みファイルのみ読み、未保存の編集、別バッファへの追従、ブラウザ側編集は実装しない。
- Pythonは標準ライブラリのみ。利用時のpip、Node.js、npm、Vite、追加アセット取得を不要にする。
- 取得間隔500 ms、取得タイムアウト2秒、連続通信失敗5秒で停止。起動タイムアウト5秒、停止はEOF→1秒後停止要求→さらに1秒後強制終了。
- 入力上限1,048,576 byte（BOMを含む）、入れ子深さ100（ルートcontainerが1）、描画上限1,500ノード。
- HTTP同時処理上限8、各接続読取・書込タイムアウト2秒。待受は`127.0.0.1:0`、256-bitトークンは毎起動生成する。
- UIはダーク固定。タブ閉鎖によるサーバー自動終了、ズーム・パン状態維持、テーマ自動切替は実装しない。
- `<leader>jp`はLazyVim設定例でToggleに割り当てる。プラグイン本体はキーを登録せず、setup呼出しも必須にしない。
- UIとREADMEは英語。依存版とlockfileを固定し、`dist/`をGit同梱。外部通信・CDN・リモートiframeは禁止する。
- セキュリティヘッダー、対応入力、コマンド意味、HTTP/IPCのwire形式は仕様書第3〜8節をそのまま契約とする。
- 独自コードのライセンス、公開先、依存NOTICEは公開前に確定する。リリース・push・公開は本計画の実行とは別の操作とする。

## Review Focus

1. 同じサイズ・mtimeで内容だけ変わった保存でも更新し、変化のない保存では再解析しない。Task 3/5で固定する。
2. 起動の取消し直後に遅れて届くreadyや旧世代の終了通知が、新しいセッションを壊さない。Task 6で固定する。
3. 対象の親ディレクトリまでsymlinkへ差し替わっても別ファイルを読まず、通常のatomic saveは許可する。Task 3/4で固定する。
4. 正常→不正→元と同じ正常内容へ戻ると、ETag最適化があってもエラーを消して復帰する。Task 5/7で固定する。
5. 日本語・空白・引用符・シェル記号を含むファイル名でも起動し、値の`__proto__`やHTML文字列を実行せず表示する。Task 2/6/7で固定する。

---

## 0. 実施順序と共通ルール

現在のリポジトリは要件書・仕様書のみで、製品コード、依存定義、テスト、CIは存在しない。以下のファイルは、Modifyと明記したもの以外は新規作成する。今回はこの計画と仕様書の承認状態だけを保存する。

実行時に`using-git-worktrees`で既存の隔離環境を確認する。作業場所を確定した後、Task 1から順に進める。実装単位は8タスクで、Web/Lua/Pythonは1つのプラグインを構成するため単一計画にまとめる。

```text
1 描画統合 ─→ 2 入力解析 ─────────┐
3 snapshot読取 ─→ 4 HTTP/子プロセス ─┼→ 5 取得/UI ─┐
                    └───────────→ 6 Lua ──────┼→ 7 結合検証 → 8 配布/CI
                                             ┘
```

標準実行順は1→2→3→4→5→6→7→8。並列化する場合も、共有するファイルと型は先に確定し、同じファイルを複数担当者が変更しない。

各タスクのテストは小さな挙動ごとに「失敗確認→最小実装→成功確認」を繰り返す。依存・設定・生成物だけの変更には形式的なテストを増やさない。欠落モジュール等でテストが実行不能な段階では、最小の型・空実装を置き、狙った挙動のassertionが失敗する状態を確認してから本体を実装する。

タスク終了時には対象テストに加え、その時点で存在する同じサブシステムの全テストを実行する。新しい差分・不具合がなければ同じ検証を繰り返さない。コードブロックのassertionは代表例であり、同じステップの表にあるケースも独立したテストにする。

## 1. ファイルと責務

| ファイル | 責務・作成タスク |
| --- | --- |
| `web/src/GraphView.tsx` | 公式グラフのラッパー、空container、上限、描画エラー（1） |
| `web/src/parse.ts`、`web/src/types.ts` | 入力検証、正規化、共有TS型（2） |
| `server/snapshot.py` | 安全な固定対象読取、revision算出（3） |
| `server/http_server.py` | 経路、認証、CSP、接続上限（4） |
| `server/main.py` | stdin初期設定、ready、EOF終了（4） |
| `web/src/poll.ts`、`web/src/App.tsx` | 取得、エラー復帰、表示状態（5） |
| `web/src/main.tsx`、`web/src/style.css`、`web/index.html` | Webエントリーと画面配置（5） |
| `lua/jsoncrack/target.lua` | バッファ検査と非同期のパス確定（6） |
| `lua/jsoncrack/process.lua` | job、stdout行分割、停止タイマー（6） |
| `lua/jsoncrack/session.lua` | 1セッションの状態遷移、autocmd（6） |
| `lua/jsoncrack/init.lua`、`plugin/jsoncrack.lua` | コマンド登録と公開Lua関数（6） |
| `web/tests/`、`tests/python/`、`tests/lua/`、`tests/integration/` | 各責務の検証（各タスク） |
| `web/scripts/build-manifest.mjs`、`web/scripts/licenses.mjs` | 許可リスト・配布ライセンス生成（5/8） |
| `dist/` | ビルド済みHTML/JS/CSS、manifest、依存表記（5/8） |
| `Makefile`、`.github/workflows/ci.yml` | 共通検証入口とCI（6/8） |
| `README.md`、`doc/jsoncrack.txt`、`LICENSE`、`docs/validation.md` | 導入・操作・開発・ライセンス・実測記録（8） |

プロトコルに新たなコード生成基盤は導入しない。Pythonのwire JSONとTS型の一致を共通fixture `tests/fixtures/snapshot-ok.json` / `snapshot-error.json`で検証する。

## Task 1: 公式コンポーネントの最小統合を検証する

**Files:** `web/package.json`、`web/package-lock.json`、`web/tsconfig.json`、`web/vite.config.ts`、`web/playwright.config.ts`、`web/src/GraphView.tsx`、`web/tests/renderer.spec.ts`、`web/tests/renderer/index.html`、`web/tests/renderer/main.tsx`、`web/tests/serve_renderer.py`、`.gitignore`、`.node-version`。

**Interfaces:** `GraphView({ json, onRendered, onRenderError }: { json: string; onRendered?: () => void; onRenderError?: (message: string) => void }): ReactElement`。検証済みJSON文字列を受け、ダークグラフまたは空/制限/描画エラーを表示する。正常描画完了通知は現在の入力に対するものだけ発火する。

- [ ] **1. 公開パッケージと実行環境を固定する。** registryの公開版、export、peer依存、CSS、LICENSE/NOTICEを確認する。承認済み仕様のmain観測版を公開版と決めつけない。互換なReact/Vite/TypeScriptとテストツールを正確な版でlockし、Node/npmの版も記録する。実行時依存には追加しない。
- [ ] **2. テスト用の配信環境と失敗する描画テストを作る。** `vite build --mode renderer-test`は`tests/renderer/index.html`を入力に`web/.renderer-dist/`へ出力する。通常配布には混ぜない。テスト用Pythonサーバーはこの出力だけを仕様のCSP付きで配信する。PlaywrightのFirefox/Chromium projectを定義する。

```ts
test('renders a primitive without treating it as source code', async ({ page }) => {
  await page.goto('/?case=string'); // fixture: JSON.stringify('hello')
  await expect(page.getByText('hello', { exact: true })).toBeVisible();
});
```

追加case：Object/Array、Number/Boolean/Null、`{}`/`[]`、1,501以上のノードとなる配列、エラー後の正常入力。通信監視でloopback以外の要求を拒否し、CSP違反を0件とする。

- [ ] **3. `npm --prefix web run test:renderer`を実行し、表示要件の失敗を確認する。** このscriptはテスト用build→ローカル配信→両ブラウザ検証を実行し、終了時に配信プロセスを回収する。
- [ ] **4. `GraphView`を実装する。** 公式CSSを読み、明示的高さ、`theme="dark"`、`maxRenderableNodes={1500}`、標準操作を設定する。描画例外を捕捉し、空containerは空だと分かる表示にする。入力変更時に古い描画完了が現入力の完了扱いにならないようにする。独自グラフは作らない。
- [ ] **5. `npm --prefix web run test:renderer`と`npm --prefix web run typecheck`が成功することを確認する。** 公開版が仕様を満たせない場合は検証記録と仕様への影響を示し、依存差し替えや機能削減を独断で行わない。通常配布のbuildはTask 5で定義する。
- [ ] **6. 対象ファイルだけをstageし、`feat: verify embedded JSON Crack renderer`でcommitする。** `.renderer-dist/`、依存ディレクトリ、ブラウザ結果はignoreする。

## Task 2: JSON/YAMLを検証し正規化する

**Files:** `web/src/types.ts`、`web/src/parse.ts`、`web/tests/parse.test.ts`、`web/vitest.config.ts`。Modify: `web/package.json` / lockfile（Vitest、jsonc-parser、yamlの直接依存とtest script）。

**Interfaces:**

```ts
type Format = 'json' | 'yaml';
type ParseResult =
  | { ok: true; json: string }
  | { ok: false; error: { code: string; message: string; line?: number; column?: number } };
function parseSource(text: string, format: Format): ParseResult;
type Snapshot = { protocol: 1; revision: string; format: Format; display_name: string } & (
  | { status: 'ok'; text: string }
  | { status: 'error'; error: { code: string; message: string } }
);
```

型は`types.ts`からexportし、後続タスクで再定義しない。

- [ ] **1. 境界値と入力拒否のテストを書く。** `parseSource`の成功結果を`JSON.parse(result.json)`して元の意味と比較する。

```ts
it('rejects duplicate JSON keys before normalization', () => {
  expect(parseSource('{"a":1,"a":2}', 'json')).toMatchObject({ ok: false });
});
it('keeps YAML 1.2 words as strings', () => {
  expect(parseSource('yes', 'yaml')).toEqual({ ok: true, json: '"yes"' });
});
```

| テスト群 | 固定するassertion |
| --- | --- |
| JSON厳密性 | コメント、末尾カンマ、複数ルート、空入力、エスケープ表現が異なる同名キーを拒否 |
| YAML基本値 | Mapping、Sequence、引用/複数行文字列、日付風文字列、Boolean、明示Nullを正規化 |
| YAML拒否 | 複数文書、1.1指定、明示/独自タグ、anchor/alias、非文字列キー、重複、`<<`を拒否 |
| 数値 | ±9,007,199,254,740,991は許可、範囲外整数・巨大指数・非有限値を拒否。整数になる指数/小数表記も検査 |
| 深さ | 深さ100は許可、101は拒否。scalarは深さ0 |
| 空文書 | YAMLの空/コメントだけは`EMPTY_DOCUMENT`、`null`/`~`は成功 |
| データ安全性 | `__proto__`/`constructor`を保持し、`Object.prototype`に変化なし。HTML文字列は文字列のまま |

- [ ] **2. `npm --prefix web test -- tests/parse.test.ts`で意図した失敗を確認する。** `test` scriptは`vitest run`とする。
- [ ] **3. `parseSource`を実装する。** JSONは構文木で重複・数値・深さを先に検査。YAMLは1.2 CoreのDocument/ASTを検査してから変換する。位置が得られるエラーは1始まりの行・列を返す。数値の検査をNumberへの丸め後だけで済ませない。
- [ ] **4. `npm --prefix web test`と`npm --prefix web run typecheck`が成功することを確認する。** JSON/YAMLの対応値に同じテストデータを使い、独自パーサーを増やさない。
- [ ] **5. `feat: validate JSON and YAML preview input`で対象差分をcommitする。**

## Task 3: 固定対象の安全な読取とsnapshotを実装する

**Files:** `server/__init__.py`、`server/snapshot.py`、`tests/python/test_snapshot.py`、`tests/fixtures/snapshot-ok.json`、`tests/fixtures/snapshot-error.json`。

**Interfaces:** `Target(path: str, format: str, display_name: str)`、`SnapshotStore(target: Target)`、`SnapshotStore.read() -> dict`。戻り値は仕様第5.1節のSnapshot。Targetは絶対実パスを検査し、読取は上限付き・直列化する。revisionは内容・形式・エラーコードに基づく不透明なハッシュとし、時刻や詳細なOS例外は混ぜない。

- [ ] **1. 一時ディレクトリと通常ファイルを使うunittestを書く。** fixtureの秘密文字列がエラー本文に出ないことも確認する。

```python
def test_same_metadata_different_content_changes_revision(self):
    before = self.store.read()
    stat = self.path.stat()
    self.path.write_bytes(b'{"a":2}')  # initial: {"a":1}
    os.utime(self.path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    self.assertNotEqual(before['revision'], self.store.read()['revision'])
```

追加検証：1,048,576 byteは許可、+1は`FILE_TOO_LARGE`、UTF-8 BOM除去、不正UTF-8拒否、削除・読取不能後の復帰、同内容で同revision、読取中変更は最大1回再試行。通常ファイルのatomic置換は成功し、末端および親ディレクトリのsymlink置換、FIFO、ディレクトリは本文を読まず失敗する。

- [ ] **2. `python3 -m unittest discover -s tests/python -p test_snapshot.py -v`で失敗を確認する。** symlink/FIFOテストには期限を設け、失敗しても実行が止まらないようにする。
- [ ] **3. Target/Storeを実装する。** LinuxのディレクトリFDを基準に各パス要素をsymlink追従なしで開き、末端は非ブロッキングでopen後に通常ファイルか確認する。文字列realpath比較だけに依存しない。BOM除去前にbyte上限を適用し、読取エラーは定義済みコードに正規化する。変更中の再試行失敗は`FILE_UNAVAILABLE`とする。
- [ ] **4. Pythonテスト全体を実行し成功を確認する。** `python3 -m unittest discover -s tests/python -v`。fixture JSONがTSのSnapshot形と一致することはTask 5でも検証する。
- [ ] **5. `feat: add bounded preview snapshots`で対象差分をcommitする。**

## Task 4: HTTP配信と子プロセスの起動終了を実装する

**Files:** `server/http_server.py`、`server/main.py`、`tests/python/test_http.py`、`tests/python/test_process.py`、`tests/python/support.py`。

**Interfaces:** `load_assets(dist_dir: Path) -> dict[str, Path]`、`create_server(store: SnapshotStore, assets: dict[str, Path], token: str) -> HTTPServer`、`main() -> int`。起動コマンドは`python3 <plugin-root>/server/main.py`。dist位置はスクリプトの配置から導出し、cwdに依存しない。

配布manifestは`dist/manifest.json`に`{"version":1,"routes":{"/":"index.html","/assets/<hash>.js":"assets/<hash>.js"}}`の形式で保存する。全参照ファイルが存在し、dist配下でsymlinkを含まず、HTMLまたは許可されたJS/CSS/font/imageであることを起動前に検査する。manifest自体、source map、LICENSEはHTTP配信しない。

- [ ] **1. 実socketと実子プロセスで失敗するテストを書く。** `support.py`の`start_server(target, dist_dir)`は一時的なプラグイン配置を作り、ready、PID、stdin、HTTP要求ヘルパーを返す。dist差し替え用の公開オプションを製品に追加しない。

```python
def test_snapshot_requires_token_even_with_matching_etag(self):
    good = self.client.snapshot()
    denied = self.client.get('/api/snapshot', token=None, etag=good.etag)
    self.assertEqual(denied.status, 401)
    self.assertNotIn(b'fixture-secret', denied.body)
```

追加検証：GET/HEAD、200→304、入力エラー200、未知経路404/query拒否、非GET/HEADは405、不正Host/重複Host/異origin/null Originは403、CORSヘッダーなし、全応答の安全ヘッダー。traversal・二重エンコード・アセットsymlinkは拒否。遅い接続を8つ保持して9つ目を速やかに拒否し、2秒タイムアウト後に回復する。

プロセステストはstdin設定分割、readyの1行JSON、異常設定、assets欠落、EOF終了、別プロセスのport/token非衝突を検証する。stdout/stderrに対象本文やAuthorizationを出さない。設定行は最大64 KiB、stderrの保持上限はLua側で16 KiBとする。

- [ ] **2. `python3 -m unittest discover -s tests/python -v`で各追加ケースの失敗を確認する。** 失敗時もfinallyで子・socket・一時ファイルを回収する。
- [ ] **3. 専用HTTPハンドラー、処理数上限、stdin監視を実装する。** 認証検査をETag判定より前に行う。Originがない正常GETは許可する。EOF時は別スレッドからserver shutdownを要求してdeadlockを避ける。未認証要求で対象ファイルを読まない。リクエスト本文を使わない経路では接続を閉じ、未読bodyを次の要求と誤解しない。
- [ ] **4. Python全テストを実行し、終了コード0・子プロセス残存なしを確認する。** 一時アセットでこのタスクを独立検証する。製品distとの検証はTask 5/7で行う。
- [ ] **5. `feat: serve authenticated local previews`で対象差分をcommitする。**

## Task 5: ポーリングとエラー復帰をUIへ統合する

**Files:** `web/src/poll.ts`、`web/src/App.tsx`、`web/src/main.tsx`、`web/src/style.css`、`web/index.html`、`web/tests/poll.test.ts`、`web/tests/App.test.tsx`、`web/tests/protocol.test.ts`、`web/scripts/build-manifest.mjs`、`dist/`。Modify: `web/package.json` / lockfile、`web/vite.config.ts`、`web/vitest.config.ts`。

**Interfaces:** Task 1のGraphView、Task 2のParseResult/Snapshot、Task 4のHTTP/manifestを利用する。

```ts
type PollEvent =
  | { kind: 'snapshot'; value: Snapshot }
  | { kind: 'connection'; state: 'connected' | 'retrying' | 'stopped'; message?: string };
function createPoller(options: {
  token: string; onEvent: (event: PollEvent) => void;
}): { start(): void; stop(): void; reconnect(): void };
function App(): ReactElement;
```

pollerは`window.location.origin`のsnapshotだけを取得し、URL fragmentからのtoken抽出はAppが行う。Reactのcleanupは`stop()`を呼ぶ。製品向けのfetch/timer設定APIは増やさず、テストではfetch境界と時計を置換する。

- [ ] **1. fake clockとHTTP境界によるテストを書く。** テスト名とassertionは以下を最低限含める。

```ts
it('does not replace the last valid graph with invalid input', async () => {
  // Render App, deliver valid snapshot A, then invalid snapshot B.
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.getByTestId('graph')).toHaveAttribute('data-json', '{"a":1}');
});
```

App単体ではGraphView境界を受け渡しデータが分かるtest stubにする。実描画の正否はTask 1/7で検証し、stubだけで製品の表示成功とは判定しない。

| テスト | 期待結果 |
| --- | --- |
| 初回/500 ms/遅延 | 即取得し、前要求が終わるまで重複しない。停止後に遅れて完了してもUI更新しない |
| ETag | 成功・入力エラー両方の最新ETagを保持。304ではparseとGraphViewの入力を変えない |
| 正常A→不正B→正常A | BのETagを送るためAが200になり、エラーが消える |
| 2秒timeout/5秒連続失敗 | retrying→stopped。成功で失敗時間をreset、401/403は即停止 |
| reconnect/cleanup | 明示再接続で再開、再mount時やcleanup後にtimer/fetchを残さない |
| wire validation | 共通fixtureを受理。protocol違い、欠落型、異常JSONは安全な接続エラーとして扱う |
| UI状態 | 初回エラー、読取エラー、停止、ノード制限、描画失敗、正常復帰を区別する |

- [ ] **2. `npm --prefix web test`で追加ケースの失敗を確認する。** Appのtext処理に対するscript風入力もここで検証する。
- [ ] **3. poller、App、通常buildを実装する。** 既定500 ms、2秒abort、5秒停止を固定し、pollerの開始/停止を冪等にする。ファイル名、形式、保存済み表示、状態、正常表示時刻、再接続ボタンを置く。時刻はGraphViewの現入力の描画成功後だけ更新する。変更がなくても接続成功は失敗履歴を消す。
- [ ] **4. `npm --prefix web run build`を定義する。** 本番は`web/index.html`→ルート`dist/`、source mapなし。出力ファイルから許可manifestを生成する。ファイル名のhash以外に時刻・絶対パス等の非決定的情報を含めない。
- [ ] **5. `npm --prefix web test`、`npm --prefix web run typecheck`、`npm --prefix web run build`、`npm --prefix web run test:renderer`を実行する。** Task 4サーバーが生成manifestを読み、実distから画面を起動できることも確認する。
- [ ] **6. `feat: update previews and recover from input errors`でソースとdistをcommitする。**

## Task 6: Neovimコマンドとセッション管理を実装する

**Files:** `lua/jsoncrack/{init,target,process,session}.lua`、`plugin/jsoncrack.lua`、`tests/minimal_init.lua`、`tests/lua/{target,process,session,commands}_spec.lua`、`tests/lua/support.lua`、`Makefile`、`.stylua.toml`、`selene.toml`。

**Interfaces:**

- `target.resolve(bufnr, callback)`：非同期の`callback(err, target)`。targetは`{bufnr, path, format, display_name, modified}`。形式判定・bufnr情報取得後、stat/realpath等は非同期に行う。
- `process.start(target, callbacks)` → handle。callbacksは`on_ready({port, token})`、`on_error(message)`、`on_exit(code)`。handleは`stop()`。開始失敗もon_error/on_exitで一度ずつ終了を報告し、世代管理はsessionが持つ。
- `session.new({resolve, start_process, open_url, notify})` → `{toggle(bufnr), open(bufnr), stop()}`。これは内部の狭い依存境界。製品ではtarget/process/`vim.ui.open`/`vim.notify`を渡す。
- `require('jsoncrack').toggle()` / `.open()` / `.stop()` → 現バッファに対する操作。`init.lua`内でsingletonを保持する。`plugin/jsoncrack.lua`が3コマンドを一度だけ登録し、setupは設けない。

- [ ] **1. plenary用bootstrapとテストを書く。** ユーザー設定を読み込まず、repoルートと兄弟の`../plenary.nvim`だけをruntimepathへ加える。plenaryは開発時取得であり、repoへvendorしない。`make test-lua TEST_FILE=tests/lua/session_spec.lua`と省略時の全Luaテスト実行を定義する。bootstrap失敗は明示的に非0で終了する。

```lua
it('stops an existing session even from another buffer', function()
  session.open(buf_a)
  fake_process:ready(12345, token)
  session.toggle(buf_b)
  assert.equals(1, fake_process.stop_count)
  assert.equals(1, fake_process.start_count)
end)
```

`tests/lua/support.lua`に実バッファ生成とfake processのready/error/exit配送を置く。製品にテスト専用状態やreset関数を追加しない。

| 対象 | テストする挙動 |
| --- | --- |
| target | 通常/新規未保存/URI/nofile/非対応、拡張子の大小、modifiedの通知、空白・日本語・引用符・`$()`入りパス |
| process | argv配列、途中分割/複数行stdout、不正ready、5秒起動timeout、stderr16 KiB、EOF→1秒→1秒の停止 |
| session | 仕様第4.1節の全遷移、resolve中の取消し、stopping中の再開拒否、Open同対象/別対象、旧世代callback無視 |
| autocmd | splitの片側切替では継続、最後のBufHiddenで停止、Unload/Wipeout/FilePost、VimLeavePre |
| commands | setup不要、再sourceで重複しない、leaderのキーマップを作らない |
| failure | Python/asset欠落、ブラウザopenが返す失敗・起動jobの失敗、子異常終了を1回通知して停止 |

- [ ] **2. `make test-lua`で各挙動の失敗を確認する。** stdout境界のテストと実autocmdのテストを混同せず、後者は本物のNeovimバッファ/ウィンドウを操作する。
- [ ] **3. target→process→session→登録の順に実装する。** 内容はLuaで読まない。targetの非同期検査中もstartingとして連打を防ぎ、取消されたresolve結果を無視する。停止要求後は子exitまで次を起動しない。停止/起動失敗でtimer、autocmd、URL、tokenを解放する。旧世代callbackには一切変更させない。
- [ ] **4. Lua lintとテストを実行する。** `make lint-lua`（stylua/selene）と`make test-lua`。Task 4サーバーを実際に起動する統合ケースでready、Openの同一URL、Stop後の終了を確認する。依存ツールがなければ未実行を明記し、成功扱いしない。
- [ ] **5. `feat: manage preview sessions from Neovim`で対象差分をcommitする。**

## Task 7: 実プロセスと両ブラウザで受け入れ条件を検証する

**Files:** `tests/integration/test_lifecycle.py`、`tests/integration/nvim_bridge.lua`、`web/tests/e2e/preview.spec.ts`、`web/tests/e2e/support.ts`、`web/tests/e2e/performance.spec.ts`、`tests/fixtures/preview.json`、`tests/fixtures/preview.yaml`。Modify: `web/playwright.config.ts`、`web/package.json`、`Makefile`。

**Interfaces:** 製品の新しい公開APIを増やさない。Python testはheadless NeovimにLuaの試験scriptを実行させる。E2E supportは`startPreview(fixture) -> { url, save(text), stop(), dispose() }`を返し、vim.ui.openを試験用に捕捉してURLだけをPlaywrightへ渡す。`save()`はNeovimで編集・`:write`まで実施する。

- [ ] **1. ACに対応した結合テストを書く。** Pythonは実PIDと待受状態、ブラウザは実画面でassertする。

```ts
test('recovers after restoring the last valid file', async ({ page }) => {
  const preview = await startPreview('preview.json');
  try {
    await page.goto(preview.url);
    await preview.save('{"value":"visible"}');
    await expect(page.getByText('visible', { exact: true })).toBeVisible();
    await preview.save('{');
    await expect(page.getByRole('alert')).toBeVisible();
    await preview.save('{"value":"visible"}');
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { await preview.dispose(); }
});
```

E2Eにはreload、タブ閉鎖→Open、別Neovim2プロセス、停止後UI、ノード超過から復帰、CSPとXSS、外部通信0件を含める。Pythonには20回開始停止、親の正常終了/SIGKILL、終了2秒以内、改名、分割ウィンドウ、Pythonなし/アセットなしを含める。失敗時も所有するPIDだけを回収する。

- [ ] **2. `python3 -m unittest discover -s tests/integration -v`と`npm --prefix web run test:e2e`を実行する。** 結合の欠落があれば再現ケースの失敗を確認する。既存実装が最初から通る場合は故意に壊さず、確認済みの契約として記録する。
- [ ] **3. 見つかった不具合だけを所有モジュールで修正し、該当単体テストにも回帰ケースを追加する。** タブの生存監視等、仕様外の仕組みは追加しない。
- [ ] **4. 両ブラウザで性能を測定する。** `npm --prefix web run test:performance`はローカル100 KiB以下・300ノード以下のfixtureを20回変更し、保存完了から画面反映まで計測する。nearest-rankのp95（昇順19番目）≤1,000 ms。常に前面で逐次測定し、CIの不安定さを理由に閾値を変更しない。条件未達は環境情報と実測値を報告する。
- [ ] **5. `make test`を実行する。** この段階でtestはPython unit、Lua、Vitest、renderer、integration、E2Eをまとめる。性能は条件を揃えた別コマンドで実施する。Playwrightのエンジン検証とは別に、実OS既定のFirefox/Chromiumから手動起動して開く先を確認する（Task 8の記録に残す）。
- [ ] **6. `test: verify preview lifecycle and browser behavior`でテストと必要な修正をcommitする。** 製品Webコードを修正した場合はdistも再生成する。

## Task 8: 配布物・ドキュメント・CIを完成させる

**Files:** `README.md`、`doc/jsoncrack.txt`、`LICENSE`、`docs/validation.md`、`web/scripts/licenses.mjs`、`scripts/check_dist.py`、`.github/workflows/ci.yml`。Modify: `Makefile`、`web/package.json`、`dist/`、`.gitignore`。

**Interfaces:** `make lint`、`make test`、`make build`、`make verify-dist`、`make check`。lintは`make lint-lua`、Webのtypecheck、Pythonのcompileallによる構文検査を実行する。buildはWebの通常buildとmanifest・依存表記生成を実行する。checkはlint→test→verify-distを実行する。`verify-dist`は通常buildの再生成後、tracked差分に加えて新規・欠落ファイルも検出して非0を返す。`licenses.mjs`はlockfile上の実行時推移依存から配布表記を生成し、採用版のLICENSE/NOTICE本文と対応させる。

- [ ] **1. 配布検査の失敗ケースを追加する。** `tests/python/test_distribution.py`でmanifest対象欠落、余分な未追跡asset、source map混入、ライセンス欠落を検出する。scriptはrepoルートで実行してcwdに依存しない。CI設定を字面だけで検査するテストは作らない。
- [ ] **2. `python3 -m unittest discover -s tests/python -p test_distribution.py -v`で失敗を確認する。** 生成物検査は一時copyを使い、開発者のdistを壊さない。
- [ ] **3. 配布検査と依存表記を実装する。** 独自コードのMIT採用・著作権表記を確定し、依存の別ライセンスを残す。ライセンスファイルがパッケージに含まれない場合は採用版の一次資料から補い、確認できない配布物を完成扱いにしない。
- [ ] **4. 英語README/vimdocを作る。** 必須環境、build不要なlazy.nvim設定、3コマンド、タブ閉鎖後の2回Toggle/Open、未保存内容、YAML制限、各上限、エラー対処、開発・テスト手順を記載する。未確定の公開先は推測せず公開前確認事項に残し、ローカル`dir`指定例はそのまま検証できる形にする。
- [ ] **5. CIを作る。** Linux上のNeovim 0.11系・stable・nightly（nightlyは参考結果）、Python 3.10と実行時の安定版で検証する。固定Node/npm、stylua、selene、plenary、Web依存とPlaywright browsersを明示的に取得する。GitHub workspace配下でrepoを`jsoncrack-nvim/`、plenaryを`plenary.nvim/`にcheckoutし、repoから`../plenary.nvim`になる配置を守る。workspace外へのcheckoutや依存のvendorはしない。push/PRで検証し、自動公開は追加しない。
- [ ] **6. 新規checkoutで`make check`を実行する。** 初回依存取得後、実行時はNode/npmをPATHから外し、loopback以外を遮断して起動・JSON/YAML保存更新を確認する。README例を分離したLazyVim環境へ導入し、キー操作と`:help jsoncrack`を確認する。利用者の通常設定は変更しない。
- [ ] **7. `docs/validation.md`にAC01〜AC25の結果・環境・証拠を記録する。** 性能結果、配布サイズ、OS既定ブラウザの確認、未実行項目を明確にする。全必須条件を満たして初めてMVP完成と判定する。公開先等が未決なら公開だけを保留する。
- [ ] **8. `build: package and validate the Neovim preview plugin`で対象差分をcommitする。** 最終レビューを行い、実装完了後は`verification-before-completion`、`finishing-a-development-branch`に従って統合方法を扱う。

## 2. 仕様とタスクの対応

| 仕様 | 実装・検証タスク |
| --- | --- |
| 第1〜2節：範囲、技術・版・オフライン | 1、4、8 |
| 第3節：コマンド、開始条件、バッファ、タブ | 6、7、8 |
| 第4節：状態遷移、子プロセス契約 | 4、6、7 |
| 第5節：HTTP、差分、再接続 | 3、4、5、7 |
| 第6節：入力、エラー、描画 | 1、2、5、7 |
| 第7節：性能、資源上限 | 3、4、5、6、7 |
| 第8節：アクセス制限、パス、CSP、ログ | 1、3、4、6、7 |
| 第9節：構成、導入、配布、ライセンス | 1、5、6、8 |
| 第10節 AC01 | 6、8 |
| AC02、AC03、AC04 | 1、2、7 |
| AC05、AC06、AC07、AC08 | 3、5、7 |
| AC09、AC10、AC11、AC12、AC13、AC14、AC15、AC16 | 4、6、7 |
| AC17、AC18、AC19 | 1、2、3、5、7 |
| AC20、AC21、AC22、AC23、AC24 | 3、4、5、7、8 |
| AC25、第11節の公開前確認 | 8 |

## 3. 実行への引き継ぎ

本計画の作成時点ではテスト環境のインストールや製品コードの実装は行っていない。計画内のコマンドは各タスクが定義する将来の検証入口であり、現在すでに存在するコマンドではない。

AGENTS.mdの方針に合わせ、実装はタスク単位のサブエージェント方式を推奨する。HTTPセキュリティ、非同期ライフサイクル、UI状態の境界があるため、各成果物を独立レビューしてから結合する。サブエージェントは既定`gpt-6-luna`、軽度`medium`・中度`xhigh`・高度`max`とし、タスクの担当ファイルを明示する。

計画確認後に実装開始を指示されたら、実行方法と作業場所に関する既存の指示を引き継いで着手する。
