# Bundled Hunspell dictionaries

The spelling dictionaries are copied from the user's MarkNote project at `C:\marknote\src-tauri\dictionaries`.
Only English and Russian are included in Hive. Each directory contains the upstream `index.aff` and `index.dic` files and the matching upstream `LICENSE` notice.

| Tag | Source | Data license |
| --- | --- | --- |
| `en` | [wooorm/dictionaries, dictionary-en 4.0.0](https://github.com/wooorm/dictionaries/tree/main/dictionaries/en) | MIT and BSD |
| `ru` | [wooorm/dictionaries, dictionary-ru 3.0.0](https://github.com/wooorm/dictionaries/tree/main/dictionaries/ru) | BSD-3-Clause |

More MarkNote languages can be added by placing a language directory here with `index.aff` and `index.dic`; the runtime discovers available supported tags by inspecting this folder.
