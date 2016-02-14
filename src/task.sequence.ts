import {transformStrings} from "./task.utils";
const objPath = require('object-path');
const assign = require('object-assign');
const Rx = require('rx');

import * as adaptors from "./adaptors";
import {Task} from "./task.resolve";
import {RunCommandTrigger} from "./command.run";
import {Runner} from "./runner";
import Seq = Immutable.Seq;
import {
    SequenceItem,
    TaskFactory,
    createSequenceParallelGroup,
    createSequenceSeriesGroup,
    createSequenceTaskItem} from "./task.sequence.factories";

interface Observer {}

export function createFlattenedSequence (tasks: Task[], trigger: RunCommandTrigger): SequenceItem[] {
    return flatten(tasks, []);

    function flatten(items: Task[], initial: SequenceItem[]): SequenceItem[] {

        function reducer(all, task: Task) {
            /**
             * If the current task has child tasks, we build a tree of
             * nested observables for it (a task with children cannot itself
             * be a task that should be run)
             */
            if (task.tasks.length) {

                /**
                 * If the current task was marked as `parallel`, all immediate children
                 * of (this task) will be run in `parallel`
                 */
                if (task.runMode === 'parallel') {
                    return all.concat(createSequenceParallelGroup({
                        taskName: task.taskName,
                        items: flatten(task.tasks, [])
                    }));
                }
                /**
                 * If the current task was marked as `series`, all immediate child tasks
                 * will be queued and run in series - each waiting until the previous
                 * one has completed
                 */
                if (task.runMode === 'series') {
                    return all.concat(createSequenceSeriesGroup({
                        taskName: task.taskName,
                        items: flatten(task.tasks, []),
                    }));
                }
            }

            /**
             * At this point, we must be dealing with a task that should be run,
             * so we first check if it's an adaptor @ task first
             */
            if (task.adaptor) {
                return all.concat(getSequenceItemWithConfig(
                    task,
                    trigger,
                    adaptors[task.adaptor].create(task, trigger),
                    {}
                ));
            }

            /**
             * Finally, if the does not have children tasks & is not an
             * adaptor task it must have at least 1 associated module
             * so we can begin working with it by first resolving
             * the top-level configuration object for it.
             */
            const localConfig = loadTopLevelConfig(task, trigger);
            /**
             * Next we load the module
             */
            const imported    = require(task.modules[0]);

            /**
             * If the current item has no sub-tasks, we can return early
             * with a simple task creation using the global config
             *
             * eg:
             *      $ crossbow run sass
             *
             * config:
             *      sass:
             *        input:  "core.scss"
             *        output: "core.css"
             *
             * -> `sass` task will be run with the configuration
             *    {input: "core.scss", output: "core.css"}
             */
            if (!task.subTasks.length) {
                return all.concat(getSequenceItemWithConfig(task, trigger, imported, localConfig));
            }

            /**
             * Now we know for sure that this task has `sub-items`
             * so if the first entry in the subTasks array is a `*` - then
             * the user wants to run all tasks under this configuration
             * object. So we need to get the keys and use each one as a lookup
             * on the local configuration.
             *
             * eg:
             *      $ crossbow run sass:*
             *
             * config:
             *   sass:
             *     site:  {input: "core.scss"}
             *     debug: {input: "debug.scss"}
             *
             * lookupKeys = ['site', 'debug']
             */
            const lookupKeys = task.subTasks[0] === '*'
                ? Object.keys(localConfig)
                : task.subTasks;

            /**
             * Now use each lookup key to generate a task
             * that uses the config object it points to
             */
            return all.concat(lookupKeys
                /**
                 * `configKey` here will be a string that represented the subTask
                 * name, so we use that to try and find a child key
                 * in the config that matched it.
                 */
                .map(configKey => objPath.get(localConfig, configKey))
                /**
                 * At this point, the reducer callback will be called once with each matched
                 * configuration item - this can then be used to generate a task with
                 * that localised configuration
                 */
                .reduce((acc, currentConfigObject) => {
                    return acc.concat(getSequenceItemWithConfig(task, trigger, imported, currentConfigObject));
                }, [])
            );
        }
        return items.reduce(reducer, initial);
    }
}

function getSequenceItemWithConfig (task: Task, trigger: RunCommandTrigger, imported: TaskFactory, config): SequenceItem[] {

    /**
     * If the module did not export a function, but has a 'tasks'
     * property that is an array, use each function from it
     * eg:
     *  module.exports.tasks [sass, cssmin, version-rev]
     */
    if (imported.tasks && Array.isArray(imported.tasks)) {
        return imported.tasks.map(function (importedFn) {
            return createSequenceTaskItem({
                fnName: importedFn.name,
                factory: importedFn,
                task: task,
                config: config
            })
        });
    }
    /**
     * If the module exported a function, use that as the factory
     * and return a single task for it.
     * eg:
     *  module.exports = function runSass() {}
     */
    if (typeof imported === 'function') {
        return [createSequenceTaskItem({
            fnName: imported.name,
            factory: imported,
            config: config,
            task: task,
        })]
    }
}

export function createRunner (items: SequenceItem[], trigger: RunCommandTrigger): Runner  {

    const flattened = flatten(items, []);

    return {
        series: () => {},
        parallel: () => {},
    };

    function flatten(items: SequenceItem[], initial: SequenceItem[]) {

        function reducer(all, item: SequenceItem) {

            /**
             * If the current task has child tasks, we build a tree of
             * nested observables for it (a task with children cannot itself
             * be a task that should be run)
             */
            /**
             * If the current task was marked as `parallel`, all immediate children
             * of (this task) will be run in `parallel`
             */
            if (item.type === 'Parallel Group') {

                return all.concat(Rx.Observable.merge(flatten(item.items, [])));
            }
            /**
             * If the current task was marked as `series`, all immediate child tasks
             * will be queued and run in series - each waiting until the previous
             * one has completed
             */
            if (item.type === 'Series Group') {
                return all.concat(Rx.Observable.concat(flatten(item.items, [])));
            }
            /**
             * Finally is item is a task, create an observable for it.
             */
            if (item.type === 'Task' && item.factory) {
                createObservableFromSequenceItem(item, trigger);
            }
        }

        return items.reduce(reducer, initial);
    }
}

function createObservableFromSequenceItem(item: SequenceItem, trigger: RunCommandTrigger) {

    return Rx.Observable.create(obs => {
            obs.done = function () {
                obs.onCompleted();
            };
            item.startTime = new Date().getTime();
            process.nextTick(function () {
                try {
                    item.factory(obs, item.opts, trigger);
                } catch (e) {
                    obs.onError(e);
                }
            });
            return () => {
                item.endTime   = new Date().getTime();
                item.duration  = item.endTime - item.startTime;
                item.completed = true;
            }
        })
        .catch(function (e) {
            console.log(e);
            return Rx.Observable.throw(e);
        })
        .share();
}

function loadTopLevelConfig(task: Task, trigger: RunCommandTrigger): any {
    return objPath.get(trigger.input.config, [task.taskName], {});
}

/**
 * Accept first an array of tasks as an export,
 * then look if a single function was exported and
 * use that instead
 * @param {Object} item
 * @param {String} taskName
 * @param {Array} previous
 * @returns {Array}
 */
function getTaskFunctions(item: any, taskName: string, previous) {

    if (typeof item === 'function') {
        return previous.concat(item);
    }

    const moduleTasks = item.tasks;

    if (Array.isArray(moduleTasks)) {
        return previous.concat(moduleTasks);
    }

    console.error('Module %s did not have a tasks array or function export', taskName);

    return previous;
}
