/**
 * New version of the GScript compiler.
 */

function until(str, terminal) {
    return str.substring(0, str.indexOf(terminal));
}

// Splits a file by newlines.
function split(f, errors) {
    let lines = f.replace(/\r\n/g, '\n').split('\n');;
    let results = [];
    for (let i = 0; i < lines.length; i++) {
        results.push({
            s: lines[i],
            source: { line: i }
        })
    }
    return results;
}

// Removes comments and empty lines.
function clean(lines, errors) {
    let cleaned = [];
    for (let l of lines) {
        let text = l.s;
        if (text.indexOf('//') >= 0) {
            text = until(text, '//');
        }
        text = text.trim();
        if (text.length > 0) {
            l.original = l.s;
            l.s = text;
            cleaned.push(l);
        }
    }
    return cleaned;
}

// Breaks things into commands, grouping multiline commands together.
// Also associates labels to each command.
function lex(lines, errors) {
    let root; // the first node seen in the file.
    let instructions = [];

    let seen_labels = { root: true };

    // assign each instruction a globally unique name.
    let current_label = "root";
    let id = 1;

    while (lines.length > 0) {
        let line = lines.shift();
        let i = line.s;

        // labels reset
        if (i.endsWith(':')) {
            let label = until(i, ':');

            if (seen_labels[label]) {
                errors.push({
                    message: "Duplicate label " + label,
                    source: line.source
                });
            } else {
                current_label = label;
                id = 1;
                seen_labels[label] = true;
            }
            continue;
        }

        let instruction = {
            key: id == 1 ? current_label : current_label + "-" + id,
            source: line.source,
        }
        id++;

        if (!root) root = instruction.key;

        let space = i.indexOf(' ') > 0 ? i.indexOf(' ') : i.length;
        instruction.command = i.substring(0, space);
        instruction.args = i.substring(space + 1);

        let command = COMMANDS[instruction.command];

        // if there's multiple lines, group them together.
        if (command && command.multiline) {
            instruction.sources = [
                line.source
            ];
            let ml = [];
            while (true) {
                line = lines.shift();

                if (!line) {
                    let message = "Multiline command " + instruction.command + " needs an end.";
                    errors.push({ message: message, source: instruction.source });
                    throw message;
                }

                if (line.s != 'end') {
                    instruction.sources.push(line.source);
                    ml.push(line);
                } else {
                    break;
                }
            }
            instruction.children = ml;
        }
        instructions.push(instruction);
    }
    return { root: root, instructions: instructions };
}

// Expands macros / syntactic sugar. So far this only exists
// for 'megaswitch'
function desugar(l, errors) {
    let desugared = [];
    let result = { root: l.root, instructions: desugared };
    for (let i in l.instructions) {
        let ii = l.instructions[i];

        if (ii.command == 'megaswitch') {
            let base = ii.key;
            for (let j in ii.children) {
                let line = ii.children[j];
                let s = line.s.split('->');

                if (s.length != 2) {
                    errors.push({
                        message: "Invalid megaswitch line: requires a '->'",
                        source: line.source
                    })
                    return result;
                }

                let condition = s[0].trim();
                let label = s[1].trim();

                let cParsed = condition.split(' ');
                let cCommand = cParsed[0].trim();
                if (cCommand == 'var') {
                    if (cParsed.length != 3) {
                        errors.push({
                            message: "Invalid megaswitch: var needs 2 arguments (ex:'var foo/bar true')",
                            source: line.source
                        })
                        return result;
                    }

                    let v = cParsed[1].trim();
                    let vv = cParsed[2].trim();
                    desugared.push({
                        source: line.source,
                        key: base + ((j == 0) ? "" : j),
                        command: "switch",
                        args: v,
                        children: [
                            { s: vv + "->" + label, source: line.source },
                            { s: "default" + "->" + base + (Number(j) + 1), source: line.source },
                        ]
                    })
                } else if (cCommand == 'hasitem') {
                    if (cParsed.length != 2) {
                        errors.push({
                            message: "Invalid megaswitch: hasitem needs 1 arguments (ex:'hasitem foo-bar-baz')",
                            source: line.source
                        })
                        return result;
                    }

                    let v = cParsed[1].trim();
                    desugared.push({
                        source: line.source,
                        key: base + ((j == 0) ? "" : j),
                        command: "hasitem",
                        args: v,
                        children: [
                            { s: "true" + "->" + label, source: line.source },
                            { s: "false" + "->" + base + (Number(j) + 1), source: line.source },
                        ]
                    })
                } else if (cCommand == 'checklevel') {
                    cParsed.shift();
                    let v = cParsed.join(' ');
                    desugared.push({
                        source: line.source,
                        key: base + ((j == 0) ? "" : j),
                        command: "checklevel",
                        args: v,
                        children: [
                            { s: "false" + "->" + label, source: line.source },
                            { s: "true" + "->" + base + (Number(j) + 1), source: line.source },
                        ]
                    })
                } else if (cCommand == 'checklevel>=') {
                    cParsed.shift();
                    let v = cParsed.join(' ');
                    desugared.push({
                        source: line.source,
                        key: base + ((j == 0) ? "" : j),
                        command: "checklevel",
                        args: v,
                        children: [
                            { s: "true" + "->" + label, source: line.source },
                            { s: "false" + "->" + base + (Number(j) + 1), source: line.source }
                        ]
                    })
                } else if (cCommand == 'default') {
                    desugared.push({
                        source: line.source,
                        key: base + j,
                        command: "goto",
                        args: label
                    });
                } else {
                    errors.push({
                        message: "Invalid megaswitch command: " + cCommand,
                        source: line.source
                    })
                }
            }
        } else {
            desugared.push(ii);
        }
    }
    return result;
}

function parseCommands(list, errors) {
    let program = { root: list.root, conversation: {} };

    let conversation = program.conversation;
    for (let j in list.instructions) {
        let ii = list.instructions[j];

        let compiled = {
            source: ii.source,
        }

        conversation[ii.key] = compiled;

        // Wire commands to the next ones unless the script ends.
        let n = list.instructions[Number(j) + 1];

        if (!n || n.command == 'end') {
            compiled.next = false;
        } else {
            compiled.next = n.key;
        }

        if (ii.command == 'end') {
            ii.type = 'noop';
            continue;
        }
        let command = COMMANDS[ii.command];

        // Aliases should be a new command.
        while (command && command.alias) { command = COMMANDS[command.alias] };

        if (!command) {
            let message = "Unknown command: " + ii.command;
            errors.push({ message: message, source: ii.source });
        } else {
            let args = ii.args;
            if (command.args) {
                args = ii.args.split(' ');

                if (args.length != command.args) {
                    errors.push({
                        message: ii.command + " command must have " + command.args + " arguments.",
                        source: ii.source
                    });
                }

                for (let i = 0; i < args.length; i++) {
                    args[i] = args[i].trim();
                }

                command.parse(ii, args, compiled, errors);
            } else if (!command.parse) {
                errors.push({ message: "Command " + ii.command + " not yet implemented.", source: ii.source });
            } else {
                command.parse(ii, compiled, errors);
            }
        }
    }
    return program;
}

function validateScript(list, errors) {
    for (let l in list.conversation) {
        let ll = list.conversation[l];

        if (!ll.type) continue; // orphaned nodes left by 'end' logic.

        let command = COMMANDS[ll.type];
        if (!command) {
            errors.push({
                message: "Unknown command: " + ll.type,
                source: ll.source,
            })
        }
    }
    return list;
}

// Simple parse method for variables with 0 or 1 arguments.
function simpleParse(key) {
    return (def, compiled, errors) => {
        compiled.type = def.command;
        if (def.args) {
            compiled[key] = def.args;
        }
    }
}

function validateVariableName(source, name, errors) {
    if (name.indexOf('/') < 0) {
        errors.push({
            message: "Variable " + name + " needs a namespace (foo/" + name + ")?",
            source: source
        })
    }
}

function validateItemName(source, name, errors, quantity) {

}

function validateSkill(source, skill, errors) {

}

const COMMANDS = {
    // this is syntactic sugar around normal switch/var/hasitem options
    'megaswitch': {
        multiline: true
    },

    // These commands don't exist in the language
    'message': {

    },
    'choice': {

    },

    // Multiline commands
    'switch': {
        multiline: true,
        parse: (ii, compiled, errors) => {
            compiled.type = 'switch'
            compiled.var = ii.args.trim();
            validateVariableName(ii.source, compiled.var, errors);
            for (let m in ii.children) {
                let mm = ii.children[m];
                if (!mm.s) {
                    console.log(mm);
                }
                let s = mm.s.split('->');

                if (s.length != 2) {
                    errors.push({
                        message: "Switch must define 'value -> label'.",
                        source: mm.source
                    })
                }

                let message = s[0].trim();
                let label = s[1].trim();
                compiled[message] = label;
            }
        }
    },
    'randomly': {
        multiline: true,
        parse: (ii, compiled, errors) => {
            compiled.type = 'randomly'
            compiled.var = ii.args.trim();
            let branches = [];
            let sum = 0.0;
            for (let m in ii.children) {
                let mm = ii.children[m];
                if (!mm.s) {
                    console.log(mm);
                }
                let s = mm.s.split('->');

                if (s.length != 2) {
                    errors.push({
                        message: "Randomly must define 'rate -> label'.",
                        source: mm.source
                    })
                }

                let rate = Number(s[0].trim());
                let label = s[1].trim();
                sum += rate;
                branches.push({ rate, label });
            }

            for (let i of branches) {
                i.rate /= sum;
            }

            compiled.branches = branches;
        }
    },
    'userchoice': {
        multiline: true,
        parse: (ii, compiled, errors) => {
            compiled.type = 'choice'
            compiled.message = ii.args.trim();
            compiled.options = {};
            for (let m in ii.children) {
                let mm = ii.children[m];
                let s = mm.s.split('->');
                let message = s[0].trim();
                let label = s[1].trim();
                compiled.options[label] = message;
            }
        }
    },
    'hasitem': {
        multiline: true,
        parse: (ii, compiled, errors) => {
            compiled.type = 'hasitem'
            let item_split = ii.args.trim().split(' ');
            compiled.item = item_split[0].trim();
            compiled.quantity = item_split[1];

            validateItemName(ii.source, compiled.item, errors, compiled.quantity);

            let hasItemTrue = false;
            for (let m in ii.children) {
                let mm = ii.children[m];
                let s = mm.s.split('->');
                let message = s[0].trim();
                let label = s[1].trim();

                if (message == 'true') hasItemTrue = true;

                compiled[message] = label;
            }

            // If an item check doesn't have a 'true' branch, it should fall through
            if (!hasItemTrue) compiled['true'] = compiled.next;
        }
    },
    'hasinvspace': {
        multiline: true,
        parse: (ii, compiled, errors) => {
            compiled.type = 'goto'
            for (let m in ii.children) {
                let mm = ii.children[m];
                let s = mm.s.split('->');

                if (s.length != 2) {
                    errors.push({
                        message: "Hasinvspace must define 'value -> label'.",
                        source: mm.source
                    })
                }

                let message = s[0].trim();
                let label = s[1].trim();
                if (message == 'true') {
                    compiled.next = label;
                }
            }
        }
    },
    'spawn_npc': {
        multiline: true,
        parse: (ii, compiled, errors) => {
            compiled.type = 'questcomplete';
            for (let m in ii.children) {
                let mm = ii.children[m];
                let s = mm.s.split(':');
                compiled[s[0].trim()] = s[1].trim();
            }
        }
    },
    'questcomplete': {
        multiline: true,
        parse: (ii, compiled, errors) => {
            compiled.type = 'questcomplete';
            compiled.xp = {};
            compiled.messages = [];
            for (let m in ii.children) {
                let mm = ii.children[m];
                let s = mm.s.split(' ');
                if (s[0].trim() == 'quest') {
                    if (s.length != 2) {
                        errors.push({
                            message: "Quest name must have only one argument.",
                            source: mm.source,
                        })
                    }
                    compiled.quest = s[1].trim();
                } else if (s[0].trim() == 'xp') {
                    if (s.length != 3) {
                        errors.push({
                            message: "XP must have a skill and amount.",
                            source: mm.source,
                        })
                    }
                    // TODO: Check valid skill name
                    compiled.xp[s[1].trim()] = Number(s[2].trim());
                } else if (s[0].trim() == 'icon') {
                    compiled.icon = s[1].trim();
                } else if (s[0].trim() == 'reward') {
                    s.shift();
                    compiled.messages.push(
                        s.join(' ')
                    );
                } else {
                    errors.push({
                        message: "Invalid quest reward type: " + s[0],
                        source: mm.source,
                    })
                }
            }
            if (!compiled.quest) {
                errors.push({
                    message: "Quest completion command must have a quest ID.",
                    source: ii.source,
                })
            }
        }
    },
    'checklevel': {
        multiline: true,
        parse: (ii, compiled, errors) => {
            compiled.type = 'checklevel'
            let l = ii.args.split(' ');
            compiled.skill = l[0].trim();
            compiled.level = Number(l[1].trim());

            validateSkill(ii.source, compiled.skill, errors);

            let checkLevelTrue = false;
            for (let m in ii.children) {
                let mm = ii.children[m];
                let s = mm.s.split('->');
                let message = s[0].trim();
                let label = s[1].trim();

                if (message == 'true') checkLevelTrue = true;

                compiled[message] = label;
            }

            // If a level check doesn't have a 'true' branch, it should fall through
            if (!checkLevelTrue) compiled['true'] = compiled.next;
        }
    },

    // The rest.
    'noop': { parse: simpleParse('args') },
    'goto': { parse: simpleParse('next') },

    'random_goto': {
        parse: (def, compiled) => {
            compiled.type = 'randomly';
            let random_goto_split = def.args.trim().split(' ');
            let rate = 1.0 / random_goto_split.length;
            compiled.branches = [];
            for (let i of random_goto_split) {
                compiled.branches.push({ rate: rate, label: i });
            }
        }
    },

    // Messages.
    'npcmessage': {
        parse: (def, compiled) => {
            compiled.type = 'message';
            compiled.speaker = '$npc';
            compiled.message = def.args;
        }
    },
    'playermessage': {
        parse: (def, compiled) => {
            compiled.type = 'message';
            compiled.speaker = '$player';
            compiled.message = def.args;
        }
    },
    'narration': {
        parse: (def, compiled) => {
            compiled.type = 'message';
            compiled.message = def.args;
        }
    },
    'otherspeaker': {
        parse: (def, compiled) => {
            compiled.type = 'message';
            let parsed = def.args.trim().split(':', 2);
            compiled.speaker = parsed[0];
            compiled.message = parsed[1];
        }
    },
    'simplemessage': {
        parse: (def, compiled) => {
            compiled.type = 'simplemessage';
            compiled.speaker = '';
            compiled.message = def.args;
        }
    },

    // Simple commands.
    'passdoor': { parse: simpleParse('args') },
    'interface': { parse: simpleParse('interface') },
    'openstore': { parse: simpleParse('store') },
    'openbank': { parse: simpleParse('bank') },
    'nothing-interesting-happens': { parse: simpleParse('args') },

    'teleport': {
        args: 3,
        parse: (def, t, compiled, errors) => {
            compiled.type = 'teleport';
            compiled.layer = t[0];
            compiled.x = t[1];
            compiled.y = t[2];
        }
    },

    // Variables
    'setvar': {
        args: 2,
        parse: (def, t, compiled, errors) => {
            validateVariableName(def.source, t[0], errors);
            compiled.type = 'setvar';
            compiled.var = t[0];
            compiled.value = t[1];
        }
    },
    'incrementvar': { parse: simpleParse('var') },

    'givexp': {
        args: 2,
        parse: (def, t, compiled, errors) => {
            compiled.type = 'givexp';
            compiled.skill = t[0];
            compiled.xp = Number(t[1]);
        }
    },
    'giveitem': {
        parse: (def, compiled, errors) => {
            compiled.type = 'giveitem';
            let i = def.args.split(' ');
            compiled.item = i[0].trim();
            // TODO: Check if item is valid and quantity for stackable
            if (i[1]) {
                compiled.quantity = i[1].trim();
            }
        }
    },
    'takeitem': {
        parse: (def, compiled, errors) => {
            compiled.type = 'takeitem';
            let i = def.args.split(' ');
            compiled.item = i[0].trim();
            // TODO: Check if item is valid and quantity for stackable
            if (i[1]) {
                compiled.quantity = i[1].trim();
            }

            compiled.success = compiled.next;
            compiled.failure = false;
        }
    },

    // Aliases
    '<': { alias: "npcmessage" },
    '>': { alias: "playermessage" },
    '=': { alias: "narration" },
    'o': { alias: "npcmessage" },
    'p': { alias: "playermessage" },
    'n': { alias: "narration" },
}

/**
 * Compiles the gscript (.gs) file to the format expected by
 * Genfanad.
 */
function compile(text) {
    let errors = [];

    try {
        let lines = split(text, errors);
        let cleaned = clean(lines, errors);
        let lexed = lex(cleaned, errors);
        let desugared = desugar(lexed, errors);
        let complete = parseCommands(desugared, errors);
        let validated = validateScript(complete, errors);

        return {
            errors: errors,
            compiled: validated,
        };
    } catch (e) {
        errors.push({
            message: e.toString()
        })
        return {
            errors: errors
        }
    }
}