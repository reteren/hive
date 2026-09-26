import { registerNodeBody } from "../notes/nodeBodies";
import ProgressBody from "../progress/ProgressBody.svelte";
import StatisticsBody from "../stats/StatisticsBody.svelte";

registerNodeBody("progress", ProgressBody);
registerNodeBody("stats", StatisticsBody);
