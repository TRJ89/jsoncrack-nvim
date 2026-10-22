# JSON Crack Preview for Neovim 機能・技術仕様書

作成日：2026-10-22

状態：レビュー用。技術選定はユーザーから委任を受けて決定。本書全体の承認は未実施。

対応要件：[RD-jsoncrack-nvim.md](../../RD-jsoncrack-nvim.md)

## 1. 目的と仕様の位置づけ

Neovimで編集中のJSON/YAMLを、既定ブラウザのJSON Crackグラフで確認できるOSSプラグインを提供する。LazyVimでキーを押すだけで開始でき、保存が表示に反映され、対象バッファを閉じると終了する体験を優先する。

本書はMVPの外部動作、内部責務、通信契約、配布方法、検証条件を定める。要件書の必須要件を基準とし、未指定の動作と数値は本書で補完する。要件書第9節の実装作業は本書の作成範囲に含めない。

### 1.1 対象と非対象

- 動作保証対象：ローカルのLinuxデスクトップとLazyVim。ブラウザはOSの既定設定を使い、FirefoxとChromiumの安定版で検証する。Neovimとブラウザは同じホストで動く。
- JSON/YAMLそれぞれ1ファイルを表示する。1 Neovimプロセスにつき同時に1セッション。
- 保存済みファイルを読む。未保存の編集内容は表示しない。
- ズーム、パン、ノード表示、標準操作は公式コンポーネントを利用する。
- SSH対応、別バッファへの自動追従、双方向編集、他形式、複数ファイル同時表示は対象外。
- タブ終了によるサーバー自動停止、更新時の表示位置維持、テーマ自動切替は採用しない。
- 本書にない拡張用設定、汎用通信層、独自描画エンジンは追加しない。

### 1.2 本書で補完した主要な判断

| 判断 | 採用内容 | 理由・利用者への影響 |
| --- | --- | --- |
| サーバー | Python 3標準ライブラリ | Pythonが必要だがHTTP解析を自作しない |
| 更新 | 500 ms間隔のHTTPポーリング | 保存通知用IPC、SSE、WebSocketを不要にする |
| 更新元 | 対象の保存済みファイル | Neovimで内容を読み取り・送信しない。外部からの保存も反映される |
| タブ閉鎖 | サーバーは継続 | Toggleを2回で停止→再起動できる。再表示用コマンドも提供する |
| YAML | 1.2 CoreのJSON互換部分集合 | 特殊構文を曖昧に変換しない |
| 導入 | ビルド済みアセットをGitに同梱 | 利用者のnpm実行や追加ダウンロードが不要 |
| 安全上限 | 1 MiB、深さ100、描画1,500ノード | 無制限の解析・描画を避ける。上限超過を画面に明示する |

上記の数値と対象範囲は要件書由来ではなく、MVPの設計判断である。

## 2. 技術構成と比較

### 2.1 採用する構成

```text
Neovim Lua
  ├─ コマンド／対象バッファ／子プロセスを管理
  ├─ stdin: 初期設定1件、終了時EOF
  └─ stdout: readyまたは起動失敗
          │
          ▼
PythonローカルHTTPサーバー（127.0.0.1、OS割当ポート）
  ├─ 起動時に許可された1ファイルだけを読み取る
  ├─ アセット許可リストからHTML/JS/CSSを配信
  └─ 認証付きGET /api/snapshot
          ▲
          │ 500 msごとに取得
          │
ブラウザ: React + TypeScript
  ├─ JSON/YAMLを検証・正規化
  ├─ エラー、接続状態、ファイル名を表示
  └─ jsoncrack-reactでグラフ表示
```

Pythonは標準ライブラリだけを使用する。pip、Node.js、npmは実行時に不要。Viteは開発・ビルド時だけ使用し、実行時には静的アセットを配信する。

### 2.2 検討した方式

| 対象 | 方式 | 比較と結論 |
| --- | --- | --- |
| HTTP | Python標準ライブラリ | 採用。既存HTTP処理を利用でき、ファイル読取もNeovimの外に置ける |
| HTTP | Lua + vim.uv | 外部ランタイム不要。ただしHTTP境界処理、接続制限などの保守負担が増えるため不採用 |
| HTTP | Node.js | 実装は可能だが、サーバーがJSである必然性がなく実行時依存を増やすため不採用 |
| 更新 | ファイル読取 + HTTPポーリング | 採用。対象ファイルを上限付きで読み、内容ハッシュで変化を検出する |
| 更新 | BufWritePost + IPC | 保存の瞬間に通知できるが、再読込要求とIPC契約が増えるため不採用 |
| 更新 | SSE / WebSocket | 低遅延だが接続・再接続管理が増える。500 msポーリングで目標を狙えるため不採用 |

Python標準HTTPサーバーをそのままディレクトリ公開に使わず、専用ハンドラーに限定する。公式資料も基本的なセキュリティ検査しか提供しないと説明しているため、第8節の制限を別途実装する。[Python公式資料](https://docs.python.org/3/library/http.server.html)

### 2.3 依存関係とバージョン方針

| 区分 | 仕様 |
| --- | --- |
| Neovim | 最低0.11。LazyVim自体が要求する版は別途満たすこと |
| Python | 最低3.10。`python3`をPATHから起動する |
| ブラウザ | リリース検証時点のFirefoxおよびChromium安定版。正確な検証版をREADMEに記録する。起動先を特定ブラウザに強制しない |
| UI | React、React DOM、TypeScript、Vite |
| 描画 | `jsoncrack-react`。調査時のmainのpackage.jsonは1.0.5、React/React DOMのpeer条件は18以上 |
| 入力解析 | `jsonc-parser`をJSON構文木検証用に直接依存として宣言、`yaml` 2系をYAML解析に使用 |
| 固定 | 実装開始時に公開済みパッケージを確認して正確な版とlockfileを固定。Git mainへの可変依存は使わない |

`jsoncrack-react`はCSSの読み込みと高さを持つ親要素を必要とする。`json`、`theme`、`maxRenderableNodes`等の公開APIを利用する。[公式README](https://github.com/AykutSarac/jsoncrack.com/tree/main/packages/jsoncrack-react)、[package.json](https://raw.githubusercontent.com/AykutSarac/jsoncrack.com/main/packages/jsoncrack-react/package.json)

公開版とmainの一致、実際のバンドルサイズ、各検証ブラウザでの描画性能は実装時の検証事項とする。調査時点のソース確認を動作確認の代わりにはしない。

## 3. ユーザー操作

### 3.1 コマンド

| コマンド | セッションなし | セッションあり |
| --- | --- | --- |
| `:JsonCrackPreviewToggle` | 現在バッファで開始 | 現在バッファに関係なく既存セッションを停止 |
| `:JsonCrackPreviewOpen` | 現在バッファで開始 | 同じ対象なら既存URLをブラウザで開く。別対象なら停止を促す通知 |
| `:JsonCrackPreviewStop` | 何もせず成功 | 既存セッションを停止 |

Open/Stopは要件書に対する小さな補完である。タブの生存確認を導入せず、閉じたプレビューを1操作で再表示できるようにする。Openはブラウザに開く要求を出すだけであり、既存タブの再利用は保証しない。

`<leader>jp`はREADMEのLazyVim設定例でToggleに割り当てる。プラグイン本体は利用者のleaderや既存キーマップを上書きしない。設定例を導入した状態をキー操作の受け入れ対象とする。

### 3.2 開始条件

1. 現在バッファが通常ファイル用であり、名前を持つこと。URI、端末、help、nofile等は拒否する。
2. 拡張子が`.json`、`.yaml`、`.yml`のいずれかであること。大文字小文字は区別せず、形式は拡張子で決定する。JSONCは対象外。
3. 保存済みの通常ファイルが存在し、読取可能であること。未保存の新規ファイルは「先に保存してください」と通知する。
4. Pythonと配布アセットが存在すること。欠落時はNeovimで理由と対処を通知し、子プロセスを残さない。

既存ファイルに未保存の変更がある場合は開始できる。「保存済みの内容を表示しています」とNeovimで一度通知する。ブラウザは未保存状態を監視せず、常に「保存済みファイルのプレビュー」と表示する。

ファイル内容の構文不正やサイズ超過は開始拒否にせず、ブラウザの入力エラーとして扱う。修正保存で復帰できる。

### 3.3 バッファとの関係

- 開始時のバッファ番号と実ファイルパスをセッションに固定する。
- `BufHidden`で停止する。単に別ウィンドウへフォーカスしただけでは停止しない。
- 複数ウィンドウ・タブページに表示中の対象については、Neovimの`BufHidden`の意味に従う。最後の表示がなくなることが終了条件。
- `BufUnload`、`BufWipeout`でも停止し、終了漏れを防ぐ。
- 対象の`BufFilePost`では停止する。`:saveas`等の改名先へ自動追従しない。
- 他バッファを保存しても対象は変えない。対象ファイルへの外部書き込みはポーリングで反映される。
- `VimLeavePre`で子プロセスを停止する。

Markdown Previewの実装も`BufHidden`に終了処理を結び付けている。ただし編集時更新や通信方式は本プラグインでは採用しない。[参考実装](https://raw.githubusercontent.com/iamcco/markdown-preview.nvim/master/autoload/mkdp/autocmd.vim)

### 3.4 タブを閉じた場合

タブ閉鎖をNeovim側の停止条件にしない。サーバーは対象バッファが非表示になるか、Stop/Toggle、Neovim終了まで残る。閉鎖時にエラー通知は出さない。

再表示はOpenで行う。キーだけなら`<leader>jp`の1回目で停止し、2回目で新しく開く。これはMVPの意図した動作としてREADMEに明記する。タブの再読み込みと閉鎖を区別するheartbeat等は導入しない。

## 4. ライフサイクル

### 4.1 状態遷移

| 現状態 | イベント | 処理と次状態 |
| --- | --- | --- |
| stopped | Toggle / Open | 事前検査し子プロセス起動 → starting |
| starting | ready受信 | URLを既定ブラウザで開く → running |
| starting | Toggle / Stop / 対象終了 | 起動を取り消して子プロセス停止 → stopping |
| starting | Open | 起動中と通知。追加起動しない |
| starting | 失敗／5秒タイムアウト | 子プロセス・タイマー解放、通知 → stopped |
| running | Toggle / Stop / 対象終了 | 子プロセスを停止 → stopping |
| running | Open（同一対象） | 同じURLを開く → running |
| running | 子プロセス異常終了 | 状態を解放、1回通知 → stopped |
| stopping | 起動要求 | 停止中と通知。要求を予約しない |
| stopping | 子プロセス終了 | 全リソース解放 → stopped |

セッションに世代番号を付け、古いjob callbackが新しい状態を書き換えないようにする。停止処理は何回呼んでも安全にする。停止中に新プロセスを立ち上げない。

### 4.2 子プロセス契約

- シェル文字列を組み立てず、引数配列でPythonを起動する。
- stdinにUTF-8のJSONを1行送る：`{"protocol":1,"path":"絶対実パス","format":"json","display_name":"example.json"}`。形式は`json`または`yaml`。
- サーバーは初期設定を検査して対象を固定し、`127.0.0.1:0`にbindする。ポートは事前探索せずOSから割り当てる。
- Pythonが256-bitのランダムトークンを生成する。
- 起動完了時のstdout：`{"event":"ready","protocol":1,"port":12345,"token":"hex文字列"}`。行区切りで受信し、途中分割・複数行を正しく処理する。
- 起動失敗時：`{"event":"error","code":"START_FAILED","message":"安全な説明"}`を出力し非0で終了する。
- stdoutはプロトコル専用。stderrは内容・トークンを含まない診断用とし、保持量を上限付きにする。
- 初期設定後のstdinは存続監視にだけ使う。EOFになったら待受を閉じ終了する。親の異常終了でも通常はEOFで回収できる。
- 明示停止はstdinを閉じる。1秒で終了しなければjobstop相当で終了を要求し、さらに1秒で終了しなければLinux上で子PIDのみを強制終了する。
- 子プロセスの終了確認後にjob参照、autocmd、タイマー、URL、トークンを破棄する。Neovim終了時はEOFと停止要求を発行し、待ち続けない。

ブラウザ起動は`vim.ui.open`を使用する。APIが報告する起動失敗ではサーバーも停止して通知する。OSが開く要求を受理した後に実際のタブが表示されたかまでは判定しない。

## 5. 更新とHTTP契約

### 5.1 配信経路

起動URLは`http://127.0.0.1:<port>/#token=<token>`。fragmentはHTTP要求に含まれない。UIはトークンをメモリに保持し、再読み込みでも利用できるようfragmentを残す。トークンをlocalStorageやCookieには保存しない。

| 経路 | 成功応答 | 条件 |
| --- | --- | --- |
| `/` | 配布されたindex.html | データ・絶対パス・トークンを埋め込まない |
| `/assets/<配布名>` | 対応する静的アセット | ビルド時に作成した許可リスト内だけ |
| `/api/snapshot` | 下記JSON、または304 | `Authorization: Bearer <token>`が必須 |

その他は404。GET/HEAD以外は405で、HEADはGETと同じ認証・ヘッダー検査を行い本文を返さない。URLやqueryで対象パスを受け取らない。未知のqueryも拒否する。

正常なsnapshotの例：

```json
{
  "protocol": 1,
  "revision": "サーバーが作る不透明な識別子",
  "format": "yaml",
  "display_name": "example.yaml",
  "status": "ok",
  "text": "name: example\n"
}
```

入力読取エラー時はHTTP 200のまま`status: "error"`とし、`text`の代わりに`error: {"code":"FILE_UNAVAILABLE","message":"..."}`を返す。コードは`FILE_UNAVAILABLE`、`FILE_TOO_LARGE`、`INVALID_ENCODING`、`TARGET_CHANGED`。本文に絶対パス、例外traceback、ファイル内容の断片を含めない。

### 5.2 差分判定とポーリング

1. 初回は直ちに取得。その後は要求開始間隔500 msを目安とし、同一タブで要求を重複させない。遅い要求の直後に未処理要求を積まない。
2. Pythonは認証済みsnapshot要求に応じて対象を上限+1 byteまで読む。ファイル全体を無制限に読むことはしない。
3. mtimeだけで変更判定しない。内容、形式、入力エラー状態からハッシュを作りrevisionとETagにする。同内容の保存ではrevisionを変えない。
4. ブラウザは取得済みETagを`If-None-Match`に付ける。最新状態と一致したら304で本文を返さない。初回、再読み込み、未取得のrevisionは200。
5. 同じrevisionでは解析もコンポーネントへのデータ差し替えも行わない。表示が背面になっても独自の短周期維持はせずブラウザのタイマー制限に従う。
6. 読取の前後でサイズや更新情報が変わる場合は1回だけ再試行し、それでも変化中なら入力読取エラーにする。次回取得で復帰を試みる。atomic saveによる同じパスの通常ファイル置換は許可する。

通常ファイルのローカル読取が前提。特殊ファイル、ディレクトリを拒否し、FIFO等に置換されても待ち続けない方法でopen後のファイル種別も確認する。ネットワークファイルシステムの遅延は性能保証外。

### 5.3 通信失敗

各取得のタイムアウトは2秒。最初の通信失敗で「再接続中」と最後のグラフを表示し、500 ms間隔で再試行する。連続失敗が5秒以上なら「プレビューは停止したか、接続できません」と表示して自動取得を停止する。401/403は即時に取得を停止する。

通常停止と異常終了をブラウザから厳密に区別するための通信は追加しない。UIの「再接続」ボタンは同じURLで取得を再開するだけで、サーバーを起動しない。新セッションはNeovimから開始する。旧タブを自動的に新セッションへ接続しない。

## 6. 入力とグラフの仕様

### 6.1 共通

- UTF-8を対象とし、先頭のUTF-8 BOMは除去する。不正なUTF-8、UTF-16等はエラー。
- 元ファイルは変更しない。改行・空白・キー順の保存機能は持たない。
- 上限は入力1 MiB（1,048,576 byte、BOMを含む）、入れ子深さ100。ルートのcontainerを深さ1と数える。超過は解析エラーとして通知する。
- 検証と正規化はブラウザで行う。解析例外、スタック上限、コンポーネント例外は画面のエラー境界で捕捉する。
- Object、Array、およびルートを含むString/Number/Boolean/Nullに対応する。
- 数値は有限のJavaScript Numberを基本とする。安全整数範囲外の整数値と非有限値はエラーにし、文字列にする対処を案内する。整数の桁落ちは変換前のトークンまたはBigIntで検出する。小数はIEEE 754の精度によることをREADMEに記載する。

### 6.2 JSON

標準JSONのみ対応する。コメント、末尾カンマ、複数のルート、空ファイル、重複キーはエラー。`jsonc-parser`でコメント等を許可しない設定と構文木検証を行い、重複キー・深さ・数値を検査する。JSON Crack自身の寛容な解析だけに入力検証を任せない。

### 6.3 YAML

YAML 1.2 Coreの単一文書を対象とする。Mappingのキーは文字列だけを許可し、Sequence、文字列、有限数、真偽値、nullに変換する。コメント、引用文字列、複数行文字列、フロー形式は利用できる。`yes`、`no`、日付風の値は1.2 Coreに従って文字列とする。

以下はMVPでエラーにする：複数文書、YAML 1.1指定、独自または明示的タグ、アンカー、エイリアス、文字列以外のキー、重複キー、非有限数。マージ目的の`<<`キーも予約扱いで拒否し、その制限を明示する。未知のタグを文字列に変えて続行しない。

空またはコメントだけの入力は「空のYAML文書」と表示し、正常なデータと区別する。明示的な`null`や`~`はNullとして描画する。

`yaml`のDocument APIでAST、errors、warningsを確認してからJSON互換値に変換する。上記の非対応構文に関する警告を無視しない。プロトタイプに関係する名前もデータキーとして扱い、設定オブジェクトへmergeしない。[yaml公式資料](https://eemeli.org/yaml/)

### 6.4 描画と画面状態

検証済みデータをJSON文字列に正規化し、`JSONCrack`の`json`へ渡す。ルートの文字列もJSONとして引用し、数値やBoolean/Nullも文字列API経由で渡す。空Object/Arrayをコンポーネントが可視化しない場合は「空のオブジェクト {}」「空の配列 []」を画面に表示する。

- ダークテーマ固定。画面上部にファイル名、形式、状態、最後に正常表示した時刻を置く。
- グラフ領域は残りの高さを使い、公式コントロールによるズーム・パンを有効にする。
- `maxRenderableNodes`は1,500に固定。超過時は上限と実ノード数を表示する。データを黙って切り捨てない。
- 更新時の表示位置はコンポーネントに任せる。自動センタリングを許可し、ズーム・パン維持は保証しない。
- 構文・変換エラーでは最後の正常なデータをコンポーネントに渡したまま保持し、最新保存内容ではないこととエラーを上部に表示する。
- 初回から不正ならエラーのみ表示する。エラー位置を取得できる場合は1始まりの行・列を添える。
- ノード上限超過や描画自体の失敗ではグラフ領域をエラー表示に置換してよい。正常な次のrevisionで再マウントして復帰する。
- エラー修正後の取得・検証成功でエラーを消す。同一エラーのポーリングで通知を連発しない。
- 入力エラーはブラウザ、起動・プロセスエラーはNeovimに表示する。エラーを戻すためだけのIPCは設けない。

UI文言とREADMEは英語を基本とする。本書の日本語文言は意味の仕様であり、翻訳文字列の完全一致は要求しない。

## 7. 性能と資源管理

通常の更新目標は保存完了からグラフ更新までおおむね1秒以内。前面の検証ブラウザ、ローカルファイル、100 KiB以下かつ300描画ノード以下を基準とし、20回の更新の95パーセンタイルを1秒以内に収める。検証時のCPU、メモリ、Neovim、Python、ブラウザの版を記録する。これは本書で補完した測定条件であり、全サイズ・背景タブへの保証ではない。

Neovimのイベントハンドラーはバッファ内容の同期読取、解析、HTTP通信、同期プロセス待機を行わない。ファイル処理は子プロセス、解析・描画はブラウザに分離する。

PythonのHTTP処理は並行接続に対応しつつ、同時処理数8、各接続の読取・書込タイムアウト2秒を上限とする。上限を超えた接続は速やかに拒否する。snapshotの読取・revision算出は直列化し、遅い要求や複数タブが無制限にスレッドを増やさないようにする。

入力の読み直しとハッシュ計算はポーリングごとに発生するが、変更がなければJSON/YAMLの再解析や描画はしない。読取上限と単一ファイルという制約の下で、この単純さを選ぶ。

## 8. セキュリティ

1. 待受はIPv4の`127.0.0.1`のみ。全インターフェースやIPv6ワイルドカードへbindしない。
2. Hostは実際の`127.0.0.1:<port>`のみ受理する。重複Hostや別ホストは拒否し、DNS rebindingによるアクセスを防ぐ。
3. APIは毎回トークン照合する。Originが存在する場合は同じoriginに限定し、`null`も拒否する。CORS許可ヘッダーは付けない。
4. トークンは起動ごとに変える。URL fragmentやAuthorization、対象本文をログに出さない。
5. 対象パスはstdinで受け取った1つだけ。開始時にsymlinkを実パスへ解決し、その実パスを固定する。以後、symlinkへの置換や別実パスへの解決変更は`TARGET_CHANGED`として拒否する。open後の種別確認と安全なパス解決で検査と読取の間のすり替えを防ぐ。
6. 静的アセットはビルドマニフェストから明示的なURL→ファイル対応を作る。ディレクトリ一覧、任意パス結合、source map配信を禁止する。`..`、二重エンコード、symlink等で配布範囲を脱出できないことを検証する。
7. データAPIは`Cache-Control: no-store`とし、ETagはUIが明示的に扱う。全応答に`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`を付ける。
8. HTMLにCSPを付ける。基準は`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`。styleのinline許可はコンポーネントの動的style用。外部通信や`unsafe-eval`は許可しない。
9. データをHTMLとして挿入しない。ノード内容、エラー、ファイル名はテキストとして表示する。ブラウザへ渡すパス情報はbasenameだけ。
10. CDN、外部フォント、テレメトリ、外部API、リモートiframeは使用しない。公式パッケージの利用によって外部通信が発生しないことを実装時に検証する。

同一OSユーザー権限を持つ悪意あるプロセスからの隔離は保証範囲外。通常のWebページや別originからのファイル読取を防ぐことをアクセス制限の目標とする。

## 9. モジュールと配布

予定する責務境界は以下とする。正確なファイル分割は実装計画で決める。

| 配置 | 責務 |
| --- | --- |
| `plugin/jsoncrack.lua` | ユーザーコマンドの登録 |
| `lua/jsoncrack/` | 対象検査、状態遷移、プロセスとautocmd管理 |
| `server/` | 標準ライブラリだけのHTTPサーバー、読取、認証、親監視 |
| `web/` | React UI、入力検証、取得処理、ビルド定義、lockfile |
| `dist/` | 同梱するHTML/JS/CSS、配信マニフェスト、ライセンス情報 |
| `tests/` | Lua、Python、ブラウザの検証fixtureとテスト |
| `README.md` / `doc/` | 英語導入・操作・制限・開発手順、vimdoc |

ユーザー設定はMVPでは必須としない。コマンド登録はプラグイン読込時に行い、`setup()`を呼ばなくても動作させる。Pythonパスやポート、更新間隔等の公開設定は追加しない。

READMEのlazy.nvim/LazyVim例はコマンドによる遅延読込と、`<leader>jp`→Toggleの`keys`指定を含める。リポジトリ名は公開先決定後に実際の値を記載する。`build`フックやインストール時のアセット取得は不要にする。

ビルド済みアセットをGit管理し、タグや通常のcheckoutにも含める。CIでlockfileに基づくビルド、アセット生成物の一致、必要ファイルとライセンスの存在を確認する。開発時のNode.js/npm版は実装開始時にVite要件を確認して固定する。

独自コードはMITを提案する。`jsoncrack-react`パッケージはApache-2.0表記とLICENSE本文を確認済み。JSON Crackリポジトリ全体の条件をパッケージへ推測適用しない。配布物には採用版・推移依存に対応するライセンス本文、必要な著作権表記・NOTICEを含める。公開前に実際の配布アーカイブ内の表記を確認する。[パッケージLICENSE](https://raw.githubusercontent.com/AykutSarac/jsoncrack.com/main/packages/jsoncrack-react/LICENSE.md)

## 10. 受け入れ条件と検証方法

以下は実装後に実行する検証であり、本書作成時点でテスト済みという意味ではない。ブラウザを使う項目はFirefoxとChromiumの両方で実施し、それぞれをOS既定にした場合に起動先が尊重されることも確認する。

| ID | 条件・操作 | 期待結果 | 主な検証層 |
| --- | --- | --- | --- |
| AC01 | Pythonのみある環境でlazy.nvimから導入 | npm/pip/buildなしでキー・コマンドが使える | 導入検証 |
| AC02 | JSONのObject/Array/各scalarを開始 | 値と階層が正しく表示される。空containerも明示 | ブラウザ |
| AC03 | YAMLの対応部分集合を開始 | JSONと同じデータ構造として表示される | 解析＋ブラウザ |
| AC04 | コメント付きJSON、重複キー、YAML非対応構文 | 理由が表示され、黙って一部だけ描画しない | 解析 |
| AC05 | 既存ファイルを未保存編集して開始 | 保存前の内容と注意表示。保存で更新 | 結合 |
| AC06 | 対象を変更保存 | 手動reload不要で更新。第7節の測定条件を満たす | 結合＋性能 |
| AC07 | 同じ内容を連続保存・ポーリング | 304となり再解析・再描画しない | HTTP＋UI |
| AC08 | 正常→構文不正→正常を保存 | 旧グラフとエラー、次に正常表示へ復帰 | ブラウザ |
| AC09 | splitの片側だけを別バッファに変更 | 対象が表示中なら継続。最後の表示を失うと停止 | headless Neovim |
| AC10 | BufUnload/BufWipeout/改名 | 対象セッションが停止する | headless Neovim |
| AC11 | タブを閉じ、OpenまたはToggleを2回 | Neovimにエラーなし。再表示できる | 手動ブラウザ |
| AC12 | タブをreload | 同じサーバーから表示でき、プロセスが増えない | ブラウザ |
| AC13 | 起動中の連打、停止、古いcallback | 重複プロセス・状態破壊なし | Lua＋結合 |
| AC14 | 20回開始停止、Neovim正常終了・強制終了 | 各回の子が回収され、通常は2秒以内に待受が消える | プロセス結合 |
| AC15 | Pythonなし、アセット欠落、ブラウザ起動失敗 | 対処可能な通知、不要プロセスなし | Lua＋結合 |
| AC16 | Neovimを2プロセス起動 | 別ポート・別トークンで独立表示 | 結合 |
| AC17 | 1 MiB超、深さ101、安全でない整数、非有限数 | 明示エラー。Neovimの操作は継続できる | 解析＋結合 |
| AC18 | 1,500ノード超過後に小さい入力を保存 | 上限メッセージから正常表示に復帰 | ブラウザ |
| AC19 | ファイル削除、読取不能、通常ファイルのatomic置換 | エラーまたは正常更新。次の正常保存で復帰 | Python＋結合 |
| AC20 | トークン欠落・不正、異なるHost/Origin、任意パス | 拒否され、対象データが応答に含まれない | HTTP |
| AC21 | traversal、symlink/FIFOへの置換、遅いHTTP接続 | 他ファイル漏洩、無期限待機、無制限スレッド増殖なし | HTTP＋Python |
| AC22 | HTML/script風の値を表示 | スクリプトが実行されずテキストになる | ブラウザ |
| AC23 | loopback以外の通信を遮断して起動・更新 | 正常動作。外部リクエストが発生しない | ブラウザ＋ネットワーク |
| AC24 | Stop後もタブを残す | 接続不能表示になり、自動取得を終了。新セッションに混ざらない | ブラウザ |
| AC25 | 配布checkoutとlockfileからビルド | 同梱アセット一致、英語README・LICENSE・依存表記あり | CI |

要件との対応：3.1→AC01/13/15、3.2→AC09/10、3.3→AC11/12/14、3.4→AC02–04/17、3.5→AC05–08、3.6→AC02/03/18。非機能5.1→AC01/25、5.2→AC06/07/17/18、5.3→AC20–23、5.4→AC13–16/24。

## 11. 実装計画へ渡す事項

本書の仕様確認後に、独立した実装計画を作成する。計画では、最初に公開版コンポーネントの最小統合でscalar・空container・CSP・オフライン動作を確認し、その後HTTPサーバー、Neovimライフサイクル、配布と受け入れ検証へ分解する。

実装担当者に委ねる事項は、内部関数名、テストライブラリ、具体的なモジュール分割、ヘッダーやファイルの安全な処理手段、エラーの英語表現である。外部動作、対応入力、上限、通信契約を変える場合は本書も更新する。

公開前に確定する事項は、リポジトリ公開先、MIT採用の最終確認、採用依存版とNOTICE、実測性能・配布サイズ。機能仕様を変えずに確定できるが、未確認のまま公開しない。

## 12. 参照資料

参照日：2026-10-22。mainやオンライン資料は変化するため、実装時には採用版の内容を確認する。

- [要件定義書](../../RD-jsoncrack-nvim.md)
- [jsoncrack-react README](https://github.com/AykutSarac/jsoncrack.com/tree/main/packages/jsoncrack-react)
- [jsoncrack-react package.json](https://raw.githubusercontent.com/AykutSarac/jsoncrack.com/main/packages/jsoncrack-react/package.json)
- [jsoncrack-react LICENSE](https://raw.githubusercontent.com/AykutSarac/jsoncrack.com/main/packages/jsoncrack-react/LICENSE.md)
- [JSON Crack parser](https://raw.githubusercontent.com/AykutSarac/jsoncrack.com/main/packages/jsoncrack-react/src/parser.ts)
- [Markdown Preview autocmd](https://raw.githubusercontent.com/iamcco/markdown-preview.nvim/master/autoload/mkdp/autocmd.vim)
- [Python http.server](https://docs.python.org/3/library/http.server.html)
- [yaml 2公式資料](https://eemeli.org/yaml/)
- [Neovim Autocommands](https://neovim.io/doc/user/autocmd.html)
