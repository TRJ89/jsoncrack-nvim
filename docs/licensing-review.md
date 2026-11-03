# Third-party licensing evidence review

This is a technical record of the dependency license evidence used by the
generated distribution notices. It does not decide license compatibility or
the legal effect of package metadata.

## MIT package entries without package-specific notices

The lockfile declares MIT for the five packages below. Their exact npm
tarballs were recovered from the local npm cache and their SHA-512 integrity
values were recomputed; each value matches `web/package-lock.json`. The
tarballs contain no standalone license, notice, or copyright file, and no
package-specific copyright year or holder. The package manifests declare MIT.
The `defaulty` README states MIT and names its author; the `dotignore` README
has a `LICENSE` heading followed only by `MIT`. Neither supplies a license
body or copyright line. The other three READMEs have no license or copyright
statement.

| Locked package | Registry tarball | Lockfile SHA-512 integrity | Pinned source evidence |
| --- | --- | --- | --- |
| `@reaviz/react-use-fuzzy@1.0.3` | [npm tarball](https://registry.npmjs.org/@reaviz/react-use-fuzzy/-/react-use-fuzzy-1.0.3.tgz) | `sha512-ON5RxiI0r9zNpEKHvxqT8zz3iI4kzc37NzB4t8lfXSWwCEkpzxWY9TB2JAdYp9LC3UW2tN9zxdMnaNBLz4atTw==` | [reaviz/react-use-fuzzy at `816b4ef`](https://github.com/reaviz/react-use-fuzzy/tree/816b4efeb8cb027f56fdb9988fa90b8bc608891f), also tagged `v1.0.3`. The repository manifest names the unscoped `react-use-fuzzy`, while the exact npm tarball manifest names `@reaviz/react-use-fuzzy`; that leaves exact source-to-tarball identity unproven. The source README has the fragment `MIT ©` but no year or holder. |
| `create-global-state-hook@0.0.2` | [npm tarball](https://registry.npmjs.org/create-global-state-hook/-/create-global-state-hook-0.0.2.tgz) | `sha512-+1gRNwtuSQIC9lQQngfcY1VARKs6R32KJjI1bFrsp0W5MbauupRW/uQF0f+ElXx8xMmuEK9wl5zqAslzj6GvCA==` | [termosa/create-global-state-hook at `4088e1c`](https://github.com/termosa/create-global-state-hook/tree/4088e1c4389ffcdaab5256f46a793c4357c933c4). This is the only commit in the source history checked and has no version tag. Its manifest names Stanislav Termosa as author; the README and implementation contain no license or copyright statement. |
| `defaulty@2.1.0` | [npm tarball](https://registry.npmjs.org/defaulty/-/defaulty-2.1.0.tgz) | `sha512-dNWjHNxL32khAaX/kS7/a3rXsgvqqp7cptqt477wAVnJLgaOKjcQt+53jKgPofn6hL2xyG51MegPlB5TKImXjA==` | [fabiorc428/defaulty at `c76c305`](https://github.com/fabiorc428/defaulty/tree/c76c305de97a62986b452749f7494fe106584834), also tagged `v2.1.0`. The README says the package is MIT-licensed and names Fabio Ricali as author, but has no copyright line. The manifest's former `fabioricali/defaulty` URL redirects to this repository. |
| `dotignore@0.1.2` | [npm tarball](https://registry.npmjs.org/dotignore/-/dotignore-0.1.2.tgz) | `sha512-UGGGWfSauusaVJC+8fgV+NVvBXkCTmVv7sk6nojDZZvuOUNGUy0Zk4UpHQD6EDjS0jpBwcACvH4eofvyzBcRDw==` | [bmeck/dotignore at `78843a5`](https://github.com/bmeck/dotignore/tree/78843a5fea53a838d784743bde4c9470e50a9930), also tagged `v0.1.2`. Its manifest names `bradleymeck` as author. The README's only license text is the word `MIT` under a license heading. |
| `use-composed-ref@1.4.0` | [npm tarball](https://registry.npmjs.org/use-composed-ref/-/use-composed-ref-1.4.0.tgz) | `sha512-djviaxuOOh7wkj0paeO1Q/4wMZ8Zrnag5H6yBvzN7AKKe8beOaED9SF5/ByLqsku8NP4zQqsvM2u3ew/tJK8/w==` | [Andarist/use-composed-ref at `ea2c9d9`](https://github.com/Andarist/use-composed-ref/tree/ea2c9d969f2f90a349f4c99338b806423824cea2), also tagged `v1.4.0`. The pinned manifest has no author field, and its README has no license or copyright statement. |

The pinned trees were checked for license-, licence-, copying-, copyright-,
and notice-named files. A path-limited history check of commits reachable from
each pinned commit found no changes to files with those names. This is a
filename/path check, not a semantic scan of every historical file or every
branch. The reaviz source-name mismatch also means its repository is not
treated as proof that the scoped tarball has identical source contents.

The generator therefore continues to use the canonical SPDX License List
v3.29.0 MIT text as a shared template where these exact packages provide no
license file. The template is not represented as a file from those packages;
its `<year>` and `<copyright holders>` placeholders remain unchanged. Author
fields are retained only as package metadata evidence and are not used to
infer copyright owners or years. The available sources do not resolve those
package-specific attribution details. A maintainer or legal reviewer still
needs to decide how to present them; this record does not call the metadata a
legal violation or declare the question cleared.

## Presence in the emitted bundle

The notice manifest covers the production runtime dependency closure in
`web/package-lock.json`, which is broader than the modules present in the
browser bundle. A Vite module-graph inspection of the emitted
`assets/index-Cfv2Sm5o.js` found rendered modules for
`@reaviz/react-use-fuzzy` (1490 bytes), `create-global-state-hook` (981),
`defaulty` (5354), and `use-composed-ref` (559). `dotignore` had no emitted
module. It remains in the lockfile runtime closure and is recorded in the
notice inventory on that basis.

## Embedded ELK worker

The generated notice identifies the worker payload by its pinned source
package, path, SHA-256, and Git blob SHA-1. It now states explicitly that the
embedded worker source is available under EPL-2.0 in the pinned
[elkjs 0.10.0 source archive](https://github.com/kieler/elkjs/archive/refs/tags/0.10.0.tar.gz)
at commit `8a4fc2e11c1a184daa156cf563961bd860980c5f`. It retains the linked
[Eclipse ELK 0.10.0 source archive](https://github.com/eclipse-elk/elk/archive/refs/tags/v0.10.0.tar.gz)
at commit `30035c605c0d45467f673f7b6b263d44dc2632da` and includes the pinned
EPL-2.0 license text in the distribution.
