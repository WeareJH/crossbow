/// <reference path="../typings/main.d.ts" />
import {isInternal} from "./task.utils";
const debug = require('debug')('cb:command.run');
import Rx = require('rx');
import Immutable = require('immutable');
import {compile} from './logger';
import {CLI, CrossbowInput, CrossbowReporter} from './index';
import {CrossbowConfiguration} from './config';
import {resolveTasks} from "./task.resolve";
import {TriggerTypes} from "./command.run";
import {Task} from "./task.resolve";
import {twoCol} from "./reporters/task.list";
import {reportTaskTree} from "./reporters/defaultReporter";
import {ReportNames} from "./reporter.resolve";

export interface Answers {
    tasks: string[]
}

export default function prompt(cli: CLI, input: CrossbowInput, config: CrossbowConfiguration, reporter: CrossbowReporter): Rx.Observable<Answers> {

    const inquirer = require('inquirer');
    const resolved = resolveTasks(Object.keys(input.tasks), {
        shared: new Rx.BehaviorSubject(Immutable.Map({})),
        cli,
        input,
        config,
        reporter,
        type: TriggerTypes.command
    });

    if (resolved.invalid.length) {

        reporter(ReportNames.TaskTree, resolved.all, config, 'Available tasks:');
        return Rx.Observable.empty<Answers>();

    } else {
        const taskSelect = {
            type: "checkbox",
            message: "Select Tasks to run with <space>",
            name: "tasks",
            choices: getTaskList(resolved.valid),
            validate: function (answer: string[]): any {
                if (answer.length < 1) {
                    return "You must choose at least one task";
                }
                return true;
            }
        };
        return Rx.Observable.fromPromise<Answers>(inquirer.prompt(taskSelect));
    }
}

export function getTaskList(tasks: Task[]) {
    const topLevelTasks = tasks.filter(x => !isInternal(x.baseTaskName));
    const col = twoCol(topLevelTasks);
    return col.map((tuple, i) => {
        return {
            name: compile(`${tuple[0]} ${tuple[1]}`),
            value: topLevelTasks[i].baseTaskName
        }
    });
}
