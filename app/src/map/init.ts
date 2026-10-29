import { registerNodeBody } from "../notes/nodeBodies";
import MapNodeBody from "./MapNodeBody.svelte";
import "./commands.svelte";
import { startAttentionTracking } from "../attention/tracker.svelte";

registerNodeBody("map", MapNodeBody);
startAttentionTracking();
