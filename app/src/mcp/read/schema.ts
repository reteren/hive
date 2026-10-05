import {
  BEACON_SIZE,
  DEFAULT_NOTE_WIDTH,
  IMPORTANCE_LEVELS,
  MOOD_KINDS,
  PURPOSE_KINDS,
  R5_BASE_WIDTHS,
  type NoteKind,
} from "../../model/note";
import type { Link } from "../../model/link";
import { MODULE_NOTE_WIDTH } from "../../modules/moduleLogic";
import { overviewLabelFor } from "../../overview/overviewLogic";

interface KindDefinition {
  description: string;
  hasText?: boolean;
  dataFields?: Record<string, string>;
}

const COMMON_FIELDS: Record<string, string> = {
  name: "Unique display name in this project.",
  text: "Stored text value. This kind renders it as user-visible content only when hasText is true.",
  x: "Top-left X coordinate in board units (u).",
  y: "Top-left Y coordinate in board units (u); Y grows downward.",
  width: "Width in board units (u).",
  height: "Manual height in board units (u), or null for automatic height.",
  scale: "Optional uniform scale from 1 to 4; absent means 1.",
  task: "Optional task state {done:boolean, doneAt:number|null}; absent or null means not a task.",
  importance: `Optional importance value: ${IMPORTANCE_LEVELS.join(", ")}, or null.`,
  purposes: `Optional array of purpose values: ${PURPOSE_KINDS.join(", ")}.`,
  moods: `Optional array of mood values: ${MOOD_KINDS.join(", ")}.`,
  color: "Optional main frame/header colour as #rrggbb.",
  accentColor: "Optional inner body colour as #rrggbb; null clears it.",
  glow: "Optional outer glow {color:#rrggbb, opacity:0.05..1, size:0.5..8 board units}.",
  headerHidden: "Optional boolean; true hides the node header.",
  zoneId: "Optional zone id, or null for no assigned zone.",
  smoothLines: "Optional boolean; true distributes rectangular link attachments along node edges.",
  time: "Optional {enabled:boolean,schedule}. Schedule is {kind:'at',date:string|null,time:'HH:MM',rule?} or {kind:'interval',minutes>=1,mode:'calendar'|'app'|'active',repeat:boolean}; optional taskMode:'stop'|'restart', view:'time'|'stopwatch', stopwatch, runtime.",
  message: "Optional message settings {sound:boolean, overhive?:boolean}.",
  embedSections: "Optional collapsed embedded sections: {message?:boolean, time?:boolean}; absent/true means expanded.",
};

const KIND_DEFINITIONS: Record<NoteKind, KindDefinition> = {
  note: { description: "Editable Markdown text note.", hasText: true },
  pro: { description: "Positive-point mini note with an editable Markdown body.", hasText: true },
  con: { description: "Negative-point mini note with an editable Markdown body.", hasText: true },
  importance: { description: "Importance module; its importance value is applied through links." },
  purpose: { description: "Purpose module; its purpose values are applied through links." },
  mood: { description: "Mood module; its mood values are applied through links." },
  beacon: { description: "Coloured board beacon with an editable Markdown body.", hasText: true },
  goal: { description: "Summary of linked tasks and goals.", dataFields: { scope: "Optional scope for counted objects: auto, board, {kind:zone,id}, or {kind:beacon,id}." } },
  progress: { description: "Progress summary for linked tasks and goals.", dataFields: { scope: "Optional scope for counted objects: auto, board, {kind:zone,id}, or {kind:beacon,id}." } },
  calculator: {
    description: "Calculator whose entries, bank, and rows are shared by calculator nodes with the same case-insensitive name.",
    dataFields: { calculatorData: "Project-level data keyed by normalized calculator name: entries[{id,expression}], bank|null, and rows[{id,label,amount,sourceNoteId}]." },
  },
  tierlist: { description: "Tier ranking with text, linked-node, or image cards.", dataFields: { tiers: "Rows {id,name,color,cards}; cards are text, note, or image records." } },
  stats: { description: "Statistics summary for linked tasks or Lists.", dataFields: { scope: "Optional scope for counted objects: auto, board, {kind:zone,id}, or {kind:beacon,id}." } },
  archive: { description: "View node for project-wide archived notes; archive contents are stored in the project index." },
  trash: { description: "View node for project-wide deleted objects; trash contents are stored in the project index." },
  inbox: { description: "Inbox view of strongly linked notes.", dataFields: { inboxGroup: "Optional temporary id that groups related Inbox twins." } },
  list: { description: "Ordered list of text rows and optional links to board objects.", dataFields: {
    listItems: "Ordered rows {id,targetId:string|null,label}; null targetId is a plain text row.",
    listStats: "Optional boolean; true shows linked-task statistics beside list rows.",
  } },
  source: { description: "Source node with a URL and/or file reference plus a description.", dataFields: { source: "{url:string|null,filePath:string|null,file?:attachment basename,description:string,locked?:true}." } },
  glossary: { description: "View and manage hive's shared user dictionary; dictionary words are stored outside the board index." },
  map: { description: "Minimap view of the current board; it has no node-specific data." },
  random: { description: "Random Choice view for eligible rows from a linked List.", dataFields: { randomPick: "Optional last pick {listId,itemId,pickedAt} in epoch milliseconds." } },
  markas: { description: "Custom mark module; marks may be applied to linked notes.", dataFields: {
    customMarks: "Optional marks array {id,text,color:#rrggbb}; text is limited to 30 characters.",
    customMarkFrame: "Optional boolean; true colours the node frame using its marks.",
  } },
  time: { description: "Reminder schedule and stopwatch view; accepts the shared time data shape." },
  message: { description: "Reminder message text and sound/display settings.", hasText: true },
  calendar: { description: "Calendar view of reminder schedules on board nodes; it has no node-specific data." },
  image: { description: "Image attachment node with optional opacity and flip state.", dataFields: {
    image: "Image attachment reference {file,mime,size,name?,naturalWidth,naturalHeight}.",
    opacity: "Optional image opacity from 0.1 to 1.",
    flipX: "Optional true flag when horizontally mirrored.",
    flipY: "Optional true flag when vertically mirrored.",
    gifStopped: "Optional true flag when an animated GIF is paused.",
  } },
  pdf: { description: "PDF attachment viewer.", dataFields: {
    media: "PDF attachment reference {kind:'pdf',file,mime,size,name?}.",
    pdfZoom: "Optional PDF zoom percentage from 50 to 300; absent fits to width.",
  } },
  format: { description: "Editable text-format attachment stored in the project.", dataFields: { media: "Text attachment reference {kind:'text',file,mime,size,name?}." } },
  audio: { description: "Audio attachment player and recorder.", dataFields: {
    media: "Optional audio attachment reference {kind:'audio',file,mime,size,name?}.",
    recordings: "Optional independent recordings [{id,name,media}].",
  } },
  video: { description: "Video attachment player.", dataFields: {
    media: "Video attachment reference {kind:'video',file,mime,size,name?}.",
    frameHidden: "Optional true flag hides the outer frame.",
  } },
  youtube: { description: "YouTube video player.", dataFields: {
    youtube: "YouTube reference containing the validated video id and URL, with optional title/metadata.",
    frameHidden: "Optional true flag hides the outer frame.",
  } },
};

const MINI_NOTE_WIDTH = 18;
const LINK_KINDS = ["strong", "weak"] as const satisfies readonly Link["kind"][];
const LINK_SHAPES = ["base", "orthogonal", "zigzag", "wave"] as const satisfies readonly Link["shape"][];

function defaultWidth(type: NoteKind): number {
  if (type in R5_BASE_WIDTHS) return R5_BASE_WIDTHS[type as keyof typeof R5_BASE_WIDTHS];
  if (type === "note") return DEFAULT_NOTE_WIDTH;
  if (type === "beacon") return BEACON_SIZE;
  if (type === "importance" || type === "purpose" || type === "mood") return MODULE_NOTE_WIDTH;
  // This is the same DEFAULT_MINI_NOTE_WIDTH used by createNoteKind for the remaining kinds.
  return MINI_NOTE_WIDTH;
}

export const NOTE_KINDS = Object.keys(KIND_DEFINITIONS) as NoteKind[];

export function buildMcpSchema() {
  return {
    kinds: NOTE_KINDS.map((type) => {
      const definition = KIND_DEFINITIONS[type];
      const dataFields = { ...COMMON_FIELDS, ...definition.dataFields };
      if (type === "beacon") delete dataFields.accentColor;
      if (!definition.hasText) {
        dataFields.text = "Stored field, but this kind's UI does not render it as text content.";
      }
      return {
        type,
        label: overviewLabelFor(type, "").kind,
        description: definition.description,
        defaultWidth: defaultWidth(type),
        hasText: definition.hasText ?? false,
        dataFields,
      };
    }),
    enums: {
      importance: [...IMPORTANCE_LEVELS],
      purposes: [...PURPOSE_KINDS],
      moods: [...MOOD_KINDS],
      linkKinds: [...LINK_KINDS],
      linkShapes: [...LINK_SHAPES],
    },
    markdown: "Text notes use CommonMark/GFM (including tables, task lists, strikethrough, and autolinks), hive highlights `==text==` with optional colour suffix `{{#rrggbb}}`, and text links `hive://point/x,y` or `hive://note/<id>` (also usable as Markdown link destinations). Inline project images use `![alt](att:<encoded-attachment-basename>){w=NN}`; width is 5–100 percent and defaults to 50 percent.",
  };
}
