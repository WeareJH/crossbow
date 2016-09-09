/// <reference path="../typings/main.d.ts" />
import {CommandTrigger, TriggerTypes} from './command.run';
import {CrossbowConfiguration} from './config';
import {LogLevel, SimpleTaskListReport, TaskTreeReport} from './reporters/defaultReporter';
import {CrossbowInput, CLI, CrossbowReporter} from './index';
import {resolveTasks} from './task.resolve';
import {getSimpleTaskList} from "./reporters/task.list";

import Immutable = require('immutable');
import Rx = require('rx');
import {ReportNames} from "./reporter.resolve";
import {getPossibleTasksFromDirectories} from "./file.utils";

function execute(trigger: CommandTrigger): any {

    const {input, config, reporter} = trigger;

    /**
     * Either resolve ALL tasks, or a subset if given
     * via the cli.
     *
     * eg:
     *      crossbow ls -> all tasks
     *      crossbow ls build-all -> only build all tasks
     */
    const toResolve = (function () {

        /**
         * First look if there's trailing task names in cli input
         * @type {string[]}
         */
        const cliTasks = trigger.cli.input.slice(1);
        if (cliTasks.length) {
            return cliTasks;
        }

        /**
         * Now build up available tasks using input + tasks directories
         */
        const taskNamesToResolve    = Object.keys(input.tasks);
        const taskNamesFromTasksDir = getPossibleTasksFromDirectories(config.tasksDir, config.cwd);
        return [...taskNamesToResolve, ...taskNamesFromTasksDir];
    })();

    /**
     * Resolve the subset
     * @type {Tasks}
     */
    const resolved = resolveTasks(toResolve, trigger);

    /**
     * handoff if requested
     */
    if (trigger.config.handoff) {
        return {tasks: resolved};
    }

    /**
     * If no tasks were matched, give the usual error
     */
    if (resolved.all.length === 0) {
        reporter({type: ReportNames.NoTasksAvailable});
        return {tasks: resolved};
    }

    /**
     * If any were invalid or if the user gave the verbose
     * flag, show the full tree
     */
    if (resolved.invalid.length || config.verbose === LogLevel.Verbose) {
        reporter({
            type: ReportNames.TaskTree,
            data: {
                tasks: resolved.all,
                config,
                title: 'Available tasks:'
            }
        } as TaskTreeReport);
    } else {
        /**
         * Otherwise just print a simple two-col list
         */
        reporter({type: ReportNames.SimpleTaskList, data: {lines: getSimpleTaskList(resolved.valid)}} as SimpleTaskListReport);
    }

    return {tasks: resolved};
}

export default function handleIncomingTasksCommand(cli: CLI, input: CrossbowInput, config: CrossbowConfiguration, reporter: CrossbowReporter) {
    execute({
        cli,
        input,
        config,
        reporter,
        type: TriggerTypes.command
    });
}
