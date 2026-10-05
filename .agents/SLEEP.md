# Sleep checkpoint
Статус: DONE 2026-09-30 — дебаг 13 закрыт, 1.3.5 собран; checkpoint устарел
Сохранено: 2026-09-30 02:53 (локальное время пользователя)
Проект / cwd / worktree: C:\hive (приложение C:\hive\app), один worktree
Ветка / HEAD: master / 656b43c «Alt overview: #353535 nodes, WASD/wheel/middle pan keep it…»

## Задача и ограничения
Дебаг 13 после установщика 1.3.4: 11 пунктов пользователь прислал в чате. Спека для агентов: C:\hive\docs\handoff\d17_tasks.md; расшифровка пунктов там же.
- Правила работы:
  - агенты — только существующие Codex-терминалы в Orca, новых не создавать;
  - коммитить часто;
  - никакой атрибуции Claude в git;
  - версии установщика: следующая 1.3.5.
- Решения пользователя в этом дебаге:
  - п.7: при включённом Overhive карточка ТОЛЬКО поверх всего, в hive её нет;
  - п.11: рамка Importance главнее рамки Mark as;
  - п.3: «Resize» зоны из режима линий переключает инструмент на обычный.

## Сделано и сохранено
- Закоммичено (656b43c и раньше):
  - п.1, 4, 5, 6 — обзор на Alt. Сделал координатор:
    - цвет #353535;
    - WASD, колёсико и средняя кнопка не выключают обзор;
    - обзор работает в любом инструменте;
    - подпись «Zone · 3» в слое OverviewZoneLabels поверх нод.
  - Проверено в браузере: docs/handoff/ov13.mjs.
- Не закоммичено, лежит на диске:
  - п.8 (агент TM, сдан): удалён TaskLinkStatus — src/time/TaskLinkStatus.svelte (D), TimeNodeBody.svelte.
  - п.7 и 11 (агент MSG2, сдан): src/messages/MessageCards.svelte, presentation.ts, src/markas/markasLogic.ts, src/modules/modules.css, tests/markas.test.ts, tests/messages.test.ts.
  - Цвет нод в обзоре, #353535 (координатор): hunk в src/notes/NoteNode.svelte. В этом же файле могут быть правки COMBO2.
  - п.9.1–9.4 (агент COMBO2, НЕ сдан, остановлен на ночь): src/combo/** (ComboHost, actions, gestures, новые dropLogic.ts, layout.ts). Возможно, ещё src/selection/resize.ts (разрешено: minWidth 30 u для хостов со встроенными разделами).
  - п.2, 3, 10 (агент LN, НЕ сдан, остановлен на ночь): src/links/LinksLayer.svelte, gestures.ts, interaction.svelte.ts, src/zones/ZonesLayer.svelte, zoneMode.svelte.ts.

## Точка остановки
- Агентам COMBO2 (term_e5895d97…, dispatch ctx_7978a93c7fb6) и LN (term_d2fc7b32…, ctx_8ab8ce601719) в 02:53 отправлено: «СТОП, сохранить, worker_done с честным статусом». Отправлено и через orchestration, и прямо в терминал. Их worker_done ещё не прочитаны.
- Orca run: run_610ba6c32966. Утром: `orca orchestration check --json`. Если ответ «consumer_fenced», сначала `orca orchestration run-use --id run_610ba6c32966`.

### Отчёт COMBO2 после остановки (пришёл в 02:5x, delivery_59113a0c1fb5, не acked)
- Сделано частично:
  - обратное объединение Task/Note → Message с подсветкой;
  - фиксированная ширина разделов;
  - вытаскивание за фон и заголовок;
  - увеличенное пустое поле текста.
- npm run check у него зелёный. npm test он НЕ запускал, тесты не добавил.
- Не сделано: minWidth 30 u в src/selection/resize.ts. Разрешение он так и не получил, хотя оно отправлено дважды. Доделать самому или ещё раз отправить разрешение.
### Отчёт LN после остановки (msg_d103153eeeee, не acked)
- Частично сделано:
  - ПКМ в режиме линий больше не подавляется обработчиком линий;
  - меню зоны разрешено в режиме линий;
  - Resize переводит инструмент в select;
  - подавление меню для cut-жестов;
  - атрибут перемещения зоны.
- npm run check зелёный.
- НЕ сделано: п.10 (прозрачность 70% при перемещении по ЛКМ и G), тесты, npm test. Изменения лежат в рабочем дереве.

## Проверки
- Последний полный прогон до правок COMBO2 и LN: npm run check 0 ошибок, npm test 882 зелёных (по отчёту MSG2). Cargo test 40 зелёных.
- Текущее рабочее дерево после остановки агентов НЕ проверено.

## Среда и процессы
- vite (:1450) и headless Edge (edge-mk, :9334) координатора остановлены.
- Перед браузерным смоуком перезапускать vite, иначе остаются старые экземпляры модулей.
- Сборка установщика:
  - запускать из C:\hive\app командой `CARGO_TARGET_DIR=C:/hive/app/src-tauri/target-alt npx tauri build`;
  - установщик копировать в app/src-tauri/target/release/bundle/nsis/.
- НЕ использовать git worktree с junction на node_modules: он стёр node_modules.

## Продолжить
1. Прочитать worker_done от COMBO2 и LN. Если не пришли, смотреть их терминалы: `orca terminal read --terminal term_…`.
2. В C:\hive\app: `npm run check` и `npx vitest run`. Всё зелёное — закоммитить по частям: TM, MSG2, COMBO2, LN. Не доделано — дораздать или доделать самому.
3. Смоук реальной мышью (скрипты в docs/handoff):
   - п.9.1: задача на Message даёт жёлтый квадрат и объединение;
   - п.9.2: вытаскивание за фон раздела;
   - п.9.3: resize объединённой ноды;
   - п.9.4: высота поля текста;
   - п.2 и 3: ПКМ в режиме линий, Resize зоны;
   - п.10: прозрачность 70% при перемещении;
   - п.7: Overhive не дублирует карточку;
   - п.11: Importance главнее Mark as.
4. Поднять версию до 1.3.5 (package.json, tauri.conf.json, Cargo.toml, Cargo.lock), собрать, обновить docs/handoff/STATUS.md и память (vault focus), отчитаться пользователю по-русски таблицей.

## Команда для завтра
«Продолжи задачу по C:\hive\.agents\SLEEP.md»
