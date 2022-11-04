# genfanad-scripting-tools
Genfanad is a brand new game based on classic games of the past. http://genfanad.com/ If you're interested in playing or developing for it, please come join our discord at https://discord.gg/uN3Vvsv

# Startup Guide
* Install Node (and npm). (https://nodejs.org/en/)
* Run the editor.
  * If you are on Windows, run (double-click) the 'start-windows.bat' file.
  * If you are on another OS, run 'node ./editor/main.js' in a terminal.
* Open the map editing tools in your browser. It defaults to http://localhost:7781/maps.html

# Feature Requests
* Feel free to send PRs or bugs to this Github repostiory.
* Please note, changes to this must be kept in sync with the game runtime code (which is not public), so any language change proposals without prior discussion will be rejected.

# Introduction
Genfanad scripts are little programs that are compiled into a graph. The program remains statically loaded in memory. Every instance of it running is just a pointer to a specific node. This allows multiple players to be talking to the same NPC at once while storing minimal state.

The compiled version of the code has a root note and a map of node name -> node info. Each node has a ‘type’ and a ‘next’ pointer, which is the next node to execute.

As you may guess, this language is very TWINE-inspired.

When a script runs, it will execute every node until it finds a stopping point – either the end of the script or a node that requires input. For example, a ‘message’ node will pause for the player to hit ‘continue’ before continuing execution. However, a ‘setvar’ node will set the variable and move onto the next node immediately.

# GScript Definition
The Genfanad Scripting language is a simple language that compiles each instruction to a node. It contains some syntactic sugar to make it easier to specify many conditions, and automatically names nodes.

It is not a complete language. If you can think of a useful language feature that would save coding time (as long as it compiles into the same nodes as before!), please let us know and we can probably build it pretty quickly. If you can think of simpler ways to implement commands we can do those as well.

# Things
Genfanad script is used, as you guessed, to script Genfanad. As such, it exposes a lot of game state using the scripts.

## Variables
Variables are per-player values – either integers or flags (true/false). Generally, they are namespaced to a specific quest. For example, cornpop/has_recipe is a quest flag for the ‘cornpop’ quest that is named ‘has_recipe’. 

Note: Every variable used takes up database space for *every* player - do not use more variables than is appropriate, and do not use variables for random ‘have I given you a random item’ flags. We may in the future choose to delete all variables after a quest is complete. 

## Skills
A player’s skill level is their current level in that skill, including all buffs. For example, if a player has 10 mining and has drunk a mining potion so is temporarily 15/10, they will pass all skill checks for level 15.

## Items
Players have a limited inventory, and items can be gained and lost using scripts.

Note: A player can lose an item at any time, so make sure if you give them something the game logic accounts for them losing it.

# Commands
A command is a single line or, in the case of multiline commands, end with a line that says ‘end’. In both cases, they are a single word and all commands are documented later in this document.

    message Hello! // this is a single line command

And an example multiline command:

    switch domain/variable // this is a multi-line command
      true -> branch1
      false -> branch2
    end // everything from ‘switch’ to ‘end’ is part of this ‘switch’ command

Some things to note about commands:
* Some are "immediate" where the command does its thing and moves on to the next node.
* Some are "delayed" where the command does its thing then the script pauses while something (typically user input) happens.
* Some are "termination" where the command ends the script after the action is performed.

# Comments
Comments use C-style double slashes. Use them to explain what your logic is doing. They can be on any line, by themselves or not. Everything after the ‘//’ is ignored, as are empty lines.

    message Hello! // This is a comment.
    // This is also a comment.

Empty lines are allowed for spacing sections out.

    // Empty lines are allowed.

# Labels
A line ending with : is a label. Other code can jump to laels, whether through ‘goto’ or through branches. Each label can only be used once in a specific script. Labels should be all lowercase and generally only contain alphanumeric characters. Labels must be on their own line.

    foo: // ‘foo’ is a label

# Simple Commands
## Messages
    npcmessage Hello. // NPC says Hello.
    playermessage Hi. // Player says hello.
    narration A weird omniscient voice says Hello too. // Narration.
    
    otherspeaker Name: Hello // Another person speaking. (UNTESTED)
    
    simplemessage This happened. // Prints that message as a game action but
                                // continues script.
    nothing-interesting-happens // self explanatory.
    
    < Hello. // Alias for NPC says.
    > Hi. // Alias for player says
    = Narration! // Alias for narration

## Interfaces
### Interface Popups
    openstore // if attached to NPC with a store, opens it
    openbank // if attached to banker, opens bank
    
    interface <type> // launches that interface type. 
    // Only ‘appearance’ is supported today.

## Movement
### Passdoor
Passdoor is a **terminating** command to be used on doors, that moves the character through the door then ends the script. Typically, if there is danger on either side of the door, you do *not* want to add dialogue before a passdoor, as that would result in a player clicking a door then getting attacked while the text appears on screen.

    passdoor // only used on scripts attached to doors – the player walks through

### Teleport
Teleports the player to a specific coordinate. Generally, scripts do not continue after you teleport, so this is a terminating command.

    teleport <layer> <x> <y>
    teleport world 10 50

## Control Flow
### Noop
Does nothing. Sometimes useful, usually not.

    noop

### goto
Jumps to a specific label. Useful when you have a few different branches that go back to a central decision tree.

    goto label

### Random goto
Randomly jumps to one of the labels specified. In this case, a, b, or c. 

This should generally only be used for alternate chat messages. Do not make any complicated logic or quest decisions use this code.

    random_goto a b c

### User Choice
Allows the player to make a choice of options.

    userchoice Question to player?
      Yes -> <label>
      No, never! -> <label>
    end

## Variables
Variables are either flags (true/false) or integer values on a player account.

Variables have a storage cost associated with them, and should be used for quests but not for general purpose things like doors or generic NPC dialogue.

### Set Variable
Sets a player flag to a value.

    setvar <domain>/<name> true
    setvar popcorn/talked_to_gourmet true
    setvar popcorn/recipe_count 5

### Increment Variable
Increments a variable by one.

    incrementvar <var>
    incrementvar popcorn/talked_count

### Variable Switch
Will read a variable and go to a branch depending on its value. If no branch exists for the specific value of the variable, it will jump to the ‘default’ branch. Generally, this should only be used for flags (true/false), rather than numeric values.

    switch <variable>
      <value> -> <label>
      <value> -> <label>
      default -> <label>
    end

## Items
Items are dash-separated item definitions and have an image, name, examine text (typically a joke), and various properties about them. For quests, almost all items must be untradeable, unsellable, and have no value. Stackable items can support multiple instances in a single inventory slot.

If an item is lost, all quest logic must have provisions for giving the item out again, to ensure no dead states are possible for any given quest.

### Give Item
Gives an item to the player. 

    giveitem smithed-weapon-bronze-dagger

This will fail and end the script if the inventory is full.

### Take Item
Takes an item from the inventory. This assumes you have checked for the player having that item first!

    takeitem <item> <quantity> // quantity only if stackable
    takeitem coins 500 // Quantity is second argument if the item is stackable.
    takeitem smithed-weapon-bronze-dagger // Quantity is omitted and does not
    // work for stackable items.

### Branching [hasitem]
Checks to see if a player has an item and jumps to a label if they do. Quantity required for stackable items.

    hasitem smithed-weapon-bronze-dagger
      true -> <label>
      false -> <label>
    end
    
    hasitem coins 50
      true -> <label>
      false -> <label>
    end

This can also be used to check things like $tool-hammer for any tool that can be used as a hammer. 

### Inventory Size Check
Branches to ensure the player has enough slots to accept multiple items. 

    hasinvspace 3
      true -> <label>
      false -> <label>
    end

Technically the ‘true’ branch can be omitted, in which case it will move onto the next instruction.

## Skills
### Check Level
    checklevel forging 25
      true -> <label>
      false -> <label>
    end

### Check XP
    checkxp forging 5000
      true -> <label>
      false -> <label>
    end

### Give XP
    givexp forging 50

## Other
### Quest Complete
TODO: Add documentation for this.

### MegaSwitch
This is syntactic sugar around multiple switch/checkitem/checklevel branches. Typically it's used to have many conditions on a given NPC, and checks conditions in the order they are listed, jumping to the first 'true' condition. Even if a later condition is true, it does not matter.

    megaswitch
      var foo/bar true -> <label> // equivalent to ‘switch’
      hasitem foo-bar-baz -> <label> // equivalent to hasitem, but quantity is not supported here
      checklevel forging 5 -> <label> // equivalent to checklevel
      default -> <label> // if everything else is false, goes here
    end

# License
The open source scripting tools are MIT licensed.