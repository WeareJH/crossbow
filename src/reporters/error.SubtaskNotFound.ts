import {Task} from "../task.resolve.d";
import {SubtaskNotFoundError} from "../task.errors";

module.exports = (task: Task, error: SubtaskNotFoundError) =>

`{red:-} {bold:Description}: Configuration under the path {yellow:${task.taskName}} -> {yellow:${error.name}} was not found.
  This means {cyan:'${task.rawInput}'} is not a valid way to run a task.`;
