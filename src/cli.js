#!/usr/bin/env node

const readline = require('readline');
const { executeSELECTQuery, executeINSERTQuery, executeDELETEQuery } = require('./queryExecutor');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.setPrompt('SQL> ');
console.log('SQL Query Engine CLI. Enter your SQL commands, or type "exit" to quit.');

rl.prompt();

rl.on('line', async (line) => {
    if (line.toLowerCase() === 'exit') {
        rl.close();
        return;
    }

    try {
        // Execute the query - do your own implementation

        switch (true) {
            case line.toLowerCase().startsWith('select'):
                executeSELECTQuery(line)
                    .then(result => console.log('Result:', result))
                    .catch(err => console.error(err));
                break;
            case line.toLowerCase().startsWith('insert into'):
                executeINSERTQuery(line)
                    .then(result => console.log(result.message))
                    .catch(err => console.error(err));
                break;
            case line.toLowerCase().startsWith('delete from'):
                executeDELETEQuery(line)
                    .then(result => console.log(result.message))
                    .catch(err => console.error(err));
                break;
            default:
                console.log('Unsupported command');
        }
    } catch (error) {
        console.error('Error:', error.message);
    }

    rl.prompt();
}).on('close', () => {
    console.log('Exiting SQL CLI');
    process.exit(0);
});