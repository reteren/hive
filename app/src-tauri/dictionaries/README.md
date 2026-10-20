# Bundled Hunspell dictionaries

The spelling dictionaries are copied from the user's MarkNote project at `C:\marknote\src-tauri\dictionaries`, all of its languages.
Each directory contains the upstream `index.aff` and `index.dic` files and the matching upstream `LICENSE` notice.
The runtime discovers the available tags by inspecting this folder.

| Tag | Source and version | Data license |
| --- | --- | --- |
| `en` | [wooorm/dictionaries `dictionary-en`](https://github.com/wooorm/dictionaries/tree/main/dictionaries/en), npm 4.0.0 | MIT and BSD |
| `ru` | [wooorm/dictionaries `dictionary-ru`](https://github.com/wooorm/dictionaries/tree/main/dictionaries/ru), npm 3.0.0 | BSD-3-Clause |
| `de` | [wooorm/dictionaries `dictionary-de`](https://github.com/wooorm/dictionaries/tree/main/dictionaries/de), npm 3.0.0 | GPL-2.0 or GPL-3.0 |
| `es` | [wooorm/dictionaries `dictionary-es`](https://github.com/wooorm/dictionaries/tree/main/dictionaries/es), npm 4.0.0 | GPL-3.0 or LGPL-3.0 or MPL-1.1 |
| `fr` | [wooorm/dictionaries `dictionary-fr`](https://github.com/wooorm/dictionaries/tree/main/dictionaries/fr), npm 3.0.0 | MPL-2.0 |
| `it` | [wooorm/dictionaries `dictionary-it`](https://github.com/wooorm/dictionaries/tree/main/dictionaries/it), npm 2.0.0 | GPL-3.0 |
| `pt` | [LibreOffice/dictionaries `pt_PT`](https://github.com/LibreOffice/dictionaries/tree/32b006a2c22a4ac7e8ed3f03346f7b3d85a970a4/pt_PT), commit `32b006a2c22a4ac7e8ed3f03346f7b3d85a970a4` (2026-08-22) | GPL-2.0-or-later or LGPL-2.1-or-later or MPL-1.1-or-later |
| `ar` | [LibreOffice/dictionaries `ar`](https://github.com/LibreOffice/dictionaries/tree/32b006a2c22a4ac7e8ed3f03346f7b3d85a970a4/ar), commit `32b006a2c22a4ac7e8ed3f03346f7b3d85a970a4` (2026-08-22) | GPL-2.0-or-later or LGPL-2.1-or-later or MPL-1.1-or-later |

The `dictionary-pt` npm package is specifically Brazilian Portuguese, so the
Portugal variant is bundled from the upstream LibreOffice Hunspell source as
`pt_PT` instead.
