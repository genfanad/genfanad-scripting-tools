function createFileDOM(path, info) {
    let dom = document.createElement('ul');
    for (let e in info) {
        let li = document.createElement('li');
        let s = document.createElement('span');
        s.innerText = e;
        li.appendChild(s);
        if (info[e] == 'file') {
            li.appendChild(s)

            //li.data_options

            li.id = path.join('/') + "/" + e;
        } else {
            let newPath = [...path, e];
            li.appendChild(createFileDOM(newPath, info[e]));
        }
        dom.appendChild(li);
    }
    return dom;
}

function createScripts(w) {
    let f = document.getElementById('files');
    f.innerHTML = "";

    let dom = createFileDOM([], w);

    $(dom).tree({
        onBeforeSelect: (n) => {
            let file = n.id;

            if (file && file.endsWith('.gs')) {
                document.getElementById('filename').value = file;
                $.ajax({
                    url: '/api/scripts/download',
                    type: 'POST',
                    data: JSON.stringify({ file: file }),
                    contentType: 'application/json',
                    success: (f) => {
                        loadedScript(file, f);
                    }
                });
            }
        }
    });

    f.appendChild(dom);
}

function saveFile() {
    let data = {
        filename: document.getElementById('filename').value,
        file: CODEMIRROR.getValue(),
    }

    $.ajax({
        url: '/api/scripts/save',
        type: 'POST',
        data: JSON.stringify(data),
        contentType: 'application/json',
        success: (f) => {
            document.getElementById('compiler-status').value = 'File saved.';
        }
    });
}

var CODEMIRROR;
var RUN_STATE = { state: 'not_running' }
var COMPILED;

function loadedScript(name, contents) {
    CODEMIRROR.setValue(contents);
}

function makeErrorMarker(text) {
    var marker = document.createElement("div");
    marker.classList.add('error');
    marker.classList.add('easyui-tooltip');
    marker.title = text;
    return marker;
}

function textChanged(instance, change) {
    let text = instance.getValue();
    let compiled = compile(text);

    CODEMIRROR.clearGutter('errors');

    for (let e of compiled.errors) {
        if (e.source) {
            CODEMIRROR.setGutterMarker(e.source.line, 'errors', makeErrorMarker(e.message));
        }
    }

    if (compiled.compiled) {
        document.getElementById('compiled').value = JSON.stringify(compiled.compiled, null, 2);
        COMPILED = compiled.compiled;
    }
    document.getElementById('compiler-status').innerText = JSON.stringify(compiled.errors);
}

function appendMessage(text, source) {
    let t = textDiv(text + (source ? ' @ ' + source.line : ''));
    document.getElementById('run_history').appendChild(t)
}

function hideText() {
    document.getElementById('run_message').style.display = 'none';
    document.getElementById('run_speaker').style.display = 'none';
    document.getElementById('run_action_continue').style.display = 'none';
    document.getElementById('run_action_choice').style.display = 'none';
}

// all the commands that can run
const INTERPRETER = {
    'noop': {
        immediate: true,
        run: (node) => { appendMessage('noop', node.source) },
    },
    'goto': {
        immediate: true,
        run: (node) => { appendMessage('Jumping to ' + node.next, node.source) },
    },

    'randomly': {
        branch: true,
        immediate: true,
        run: (node) => {
            let val = Math.random();

            let next = undefined;
            for (let i of node.branches) {
                val -= i.rate;
                if (val <= 0) { next = i.label; break; }
            }

            if (!next) {
                LOG.log("Script " + c.script + " error: random branch did not exist.");
                return 'done';
            }
            RUN_STATE.node = next;
        }
    },

    'simplemessage': {
        immediate: true,
        run: (node) => { appendMessage('simple message: ' + node.message, node.source) },
    },
    'nothing-interesting-happens': {
        immediate: true,
        run: (node) => { appendMessage('Nothing interesting happens.', node.source) },
    },
    'interface': {
        immediate: true,
        run: (node) => {
            appendMessage('Interface ' + node.interface + ' opened.');
        }
    },
    'openbank': {
        immediate: true,
        branch: true,
        run: (node) => {
            appendMessage('Bank opened. Script stopped.', node.source);
            RUN_STATE = { state: 'completed' };
        }
    },
    'openstore': {
        immediate: true,
        branch: true,
        run: (node) => {
            appendMessage('Store opened. Script stopped.', node.source);
            RUN_STATE = { state: 'completed' };
        }
    },
    'teleport': {
        immediate: true,
        run: (node) => {
            appendMessage('Teleporting player to ' + JSON.stringify({ layer: node.layer, x: Number(node.x), y: Number(node.y) }), node.source);
        }
    },
    'passdoor': {
        immediate: true,
        run: (node) => {
            appendMessage('Walking through the door, if this is a door.', node.source);
        }
    },
    'givexp': {
        immediate: true,
        run: (node) => {
            appendMessage(`Giving player ${node.xp} ${node.skill} xp`, node.source);
        }
    },

    // Variables
    'setvar': {
        immediate: true,
        run: (node) => {
            appendMessage(`Setting ${node.var} to ${node.value}`, node.source);
            setVariable(node.var, node.value);
        }
    },
    'incrementvar': {
        immediate: true,
        run: (node) => {
            let vv = getVariable(node.var);
            if (!vv) vv = 0; else vv = Number(vv);
            setVariable(node.var, vv + 1);

            appendMessage(`Incrementing ${node.var} from ${vv} to ${vv + 1}`, node.source);
        }
    },
    'switch': {
        branch: true,
        immediate: true,
        run: (node) => {
            let vv = getVariable(node.var);

            appendMessage(`Variable ${node.var} is ${vv}`, node.source)

            // cast to boolean if needed
            if (node["true"]) {
                if (vv == 'false') vv = false;
                vv = vv ? true : false;
            }
            let next = node[vv] || node.default;
            RUN_STATE.node = next;
        }
    },

    // items
    'giveitem': {
        branch: true,
        immediate: true,
        run: (node) => {
            let result = giveItem(node.item, node.quantity);
            appendMessage(`Giving ${node.item} x${node.quantity}`, node.source)

            if (result) {
                updateItem();
                RUN_STATE.node = node.next;
            } else {
                appendMessage('Inventory full, so script finished.')
                RUN_STATE = { state: 'completed' };
            }
        }
    },
    'takeitem': {
        branch: true,
        immediate: true,
        run: (node) => {
            let result = takeItem(node.item, node.quantity);
            if (result) {
                appendMessage(`Taking ${node.item} x${node.quantity}`, node.source)
                updateItem();
                RUN_STATE.node = node.success;
            } else {
                appendMessage(`Could not take ${node.item} x${node.quantity}`, node.source)
                RUN_STATE.node = node.failure;
            }
        }
    },
    'hasitem': {
        branch: true,
        immediate: true,
        run: (node) => {
            let result = hasItem(node.item, node.quantity);
            result = result ? "true" : "false";

            appendMessage(`Checking ${node.item} x${node.quantity}: ${result}`, node.source)
            RUN_STATE.node = node[result];
        }
    },

    'questcomplete': {
        immediate: true,
        branch: true,
        run: (node) => {
            let questVar = node.quest + '/complete';
            if (getVariable(questVar)) {
                appendMessage('DUPLICATE QUEST COMPLETION: ' + node.quest, node.source);
            }

            setVariable(questVar, true);

            appendMessage('Quest complete: ' + node.quest, node.source);
            for (let i of node.messages) {
                appendMessage('Quest reward: ' + i, node.source);
            }

            RUN_STATE = { state: 'completed' };
        }
    },

    'checklevel': {
        branch: true,
        immediate: true,
        run: (node) => {
            let vv = getSkill(node.skill);
            appendMessage(`Skill ${node.skill} is ${vv}`, node.source);
            if (vv >= node.level) {
                appendMessage(`Skill check pass`, node.source);
                RUN_STATE.node = node['true'];
            } else {
                appendMessage(`Skill check fail`, node.source);
                RUN_STATE.node = node['false'];
            }
        }
    },

    'message': {
        immediate: false,
        run: (node) => {
            document.getElementById('run_speaker').style.display = 'block';
            document.getElementById('run_message').style.display = 'block';

            document.getElementById('run_speaker').innerText = node.speaker;
            document.getElementById('run_message').innerText = node.message;
            document.getElementById('run_action_continue').style.display = 'block';
            document.getElementById('run_action_choice').style.display = 'none';
        },
        continue: (node) => {
            RUN_STATE.node = node.next;
        }
    },

    'choice': {
        branch: true,
        immediate: false,
        run: (node) => {
            document.getElementById('run_message').style.display = 'block';
            document.getElementById('run_message').innerText = node.message;
            document.getElementById('run_action_continue').style.display = 'none';
            let choice = document.getElementById('run_action_choice');
            choice.innerHTML = '';
            choice.style.display = 'block';
            for (let i in node.options) {
                let option = document.createElement('div');
                option.classList.add('run_choice');
                option.innerText = node.options[i];
                option.onclick = () => {
                    runContinue(i);
                }
                choice.appendChild(option);
            }
        },
        continue: (node, option) => {
            document.getElementById('run_action_choice').style.display = 'none';
            RUN_STATE.node = option;
        }
    }
}

function runUpdateState() {
    document.getElementById('run_state').innerText = JSON.stringify(RUN_STATE);

    CODEMIRROR.clearGutter('running');
    let node = COMPILED.conversation[RUN_STATE.node];
    if (node && node.source) {
        CODEMIRROR.setGutterMarker(node.source.line, 'running', makeLineMarker());
    }
}

function runScriptStep() {
    let node = COMPILED.conversation[RUN_STATE.node];
    if (!node) {
        runEnd();
        return;
    }

    appendMessage('Running ' + RUN_STATE.node, node.source);
    hideText();

    let command = INTERPRETER[node.type];
    if (!command) {
        appendMessage('Unknown command: ' + node.type, node.source);

        RUN_STATE.node = node.next;
        runUpdateState();
        return;
    }
    command.run(node);
    runUpdateState();

    if (command.immediate) {
        if (!command.branch) {
            RUN_STATE.node = node.next;
        }
        runScriptStep();
    }
}

function runContinue(option) {
    hideText();

    let node = COMPILED.conversation[RUN_STATE.node];
    if (!node) return;
    let command = INTERPRETER[node.type];

    if (command) {
        command.continue(node, option);
        runScriptStep();
    }
}

function runStep() {
    runScriptStep();
}

function runStart() {
    if (!COMPILED || !COMPILED.root) alert("No file is loaded.");

    document.getElementById('run_history').innerText = 'Started Script';
    RUN_STATE = { state: 'running', node: COMPILED.root };
    runUpdateState();

    runScriptStep();
}

function runEnd() {
    RUN_STATE = { state: 'completed' };
    runUpdateState();
}

// updated by ui and scripts
var variables = [];
var skills = [];
var items = [
]

var SKILL_DEFS = {
    "vitality": { group: "Combat" },
    "attack": { group: "Combat" },
    "strength": { group: "Combat" },
    "defense": { group: "Combat" },
    "rangedy": { group: "Combat" },
    "sorcery": { group: "Combat" },

    "dexterity": { group: "Support" },
    "piety": { group: "Support" },
    "deception": { group: "Support" },
    "survival": { group: "Support" },

    "botany": { group: "Gathering" },
    "logging": { group: "Gathering" },
    "mining": { group: "Gathering" },
    "fishing": { group: "Gathering" },

    "alchemy": { group: "Processing" },
    "cooking": { group: "Processing" },
    "crafting": { group: "Processing" },
    "tailoring": { group: "Processing" },
    "whittling": { group: "Processing" },
    "forging": { group: "Processing" },
}

for (let i in SKILL_DEFS) {
    skills.push({
        name: i,
        value: 1,
        group: SKILL_DEFS[i].group,
        editor: "numberbox",
    });
}

function getSkill(skill) {
    for (let i of skills) {
        if (i.name == skill) return Number(i.value);
    }
}

function getVariable(name) {
    let split = name.split('/', 2);
    for (let i of variables) {
        if (i.group == split[0] && i.name == split[1]) {
            return i.value;
        }
    }
}

function addVariable(name, value) {
    if (!name) name = prompt('New variable name?');
    if (name) {
        let split = name.split('/', 2);

        variables.push({
            name: split[1],
            value: value || "",
            group: split[0],
            editor: "text",
        });
        updateVariable();
    }
}

function setVariable(name, value) {
    let split = name.split('/', 2);
    let found = false;
    for (let i of variables) {
        if (i.name == split[1] && i.group == split[0]) {
            found = true;
            i.value = value;
        }
    }
    if (!found) addVariable(name, value); else updateVariable();
}

function updateVariable() {
    $('#vartable').propertygrid({
        data: variables,
    })
}

function deleteVariable() {
    var row = $('#vartable').datagrid('getSelected');
    if (row) {
        variables = variables.filter((e) => e != row);
        $('#vartable').propertygrid({
            data: variables,
        })
    }
}

function giveItem(id, quantity = 1) {
    let found = false;
    for (let i of items) {
        if (i.item == id && i.stackable) {
            i.quantity = Number(i.quantity) + Number(quantity);
            found = true;
        }
    }

    if (!found && items.length < 30) {
        addItem(id, quantity)
        found = true;
    }

    updateItem();

    return found;
}

// TODO: Tool/container checks.
function hasItem(id, quantity = 1) {
    let count = 0;
    for (let i of items) {
        if (i.item == id) {
            if (i.stackable == 'Y') {
                return i.quantity >= quantity;
            } else {
                count++;
            }
        }
    }
    return count >= quantity;
}

function takeItem(id, quantity = 1) {
    for (let i of items) {
        if (i.item == id) {
            if (i.quantity >= quantity) {
                i.quantity -= quantity;
                return true;
            }
        }
    }
    updateItem();
}

function addItem(name, quantity) {
    if (!name) {
        name = document.getElementById('itemlist').value;
    }
    if (name && name != 'none') {
        items.push({
            name: ITEM_DEFS[name].name,
            item: name,
            stackable: ITEM_DEFS[name].stackable ? 'Y' : 'N',
            quantity: quantity || 1,
        });
    }
    updateItem();
}

function updateItem() {
    items = items.filter((e) => e.quantity > 0);
    $('#itemtable').datagrid({
        data: items,
    })
}

function stateSnapshot() {
    let state = {
        variables: variables,
        skills: skills,
        items: items
    }
    localStorage.setItem('snapshot', JSON.stringify(state));
}

function stateRestore() {
    let state = JSON.parse(localStorage.getItem('snapshot'));
    variables = state.variables;
    skills = state.skills;
    items = state.items;
    $('#vartable').propertygrid({
        data: variables,
        showGroup: true,
    })
    $('#itemtable').datagrid({
        data: items,
    })
    $('#skilltable').propertygrid({
        data: skills,
        showGroup: true,
    })
}

var ITEM_DEFS = {};

function createItemDefs(defs) {
    ITEM_DEFS = defs;
    let itemList = document.getElementById('itemlist');
    for (let model in defs) {
        let option = document.createElement('option');
        option.value = model;
        option.text = model;
        itemList.appendChild(option);
    }
}

function load() {
    $.getJSON('/api/scripts', createScripts);
    $.getJSON('/api/items', createItemDefs);
    CODEMIRROR = CodeMirror.fromTextArea(document.getElementById('code'), {
        lineNumbers: true,
        lineWrapping: true,
        gutters: ["CodeMirror-linenumbers", 'errors', 'running']
    })
    CODEMIRROR.on('change', textChanged);

    // Refreshing the editor as it wasn't visible previously.
    $('#code-tabs').tabs({
        onSelect: (title) => {
            CODEMIRROR.refresh();
        }
    })

    $('#vartable').propertygrid({
        data: variables,
        showGroup: true,
    })
    $('#itemtable').datagrid({
        data: items,
    }).datagrid('enableCellEditing');
    $('#skilltable').propertygrid({
        data: skills,
        showGroup: true,
    })
}

$(load);

function makeLineMarker() {
    var marker = document.createElement("div");
    marker.classList.add('runline');
    marker.innerText = '⇨';
    return marker;
}

function textDiv(text) {
    let e = document.createElement('div');
    e.innerText = text;
    return e;
}