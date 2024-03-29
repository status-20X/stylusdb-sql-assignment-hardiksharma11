const { parseQuery } = require('./queryParser');
const readCSV = require('./csvReader');

function performInnerJoin(data, joinData, joinCondition, fields, table) {
    return data.flatMap(mainRow => {
        return joinData
            .filter(joinRow => {
                const mainValue = mainRow[joinCondition.left.split('.')[1]];
                const joinValue = joinRow[joinCondition.right.split('.')[1]];
                return mainValue === joinValue;
            })
            .map(joinRow => {
                return fields.reduce((acc, field) => {
                    const [tableName, fieldName] = field.split('.');
                    acc[field] = tableName === table ? mainRow[fieldName] : joinRow[fieldName];
                    return acc;
                }, {});
            });
    });
}


function performLeftJoin(data, joinData, joinCondition, fields, table) {
    return data.flatMap(mainRow => {
        const matchingJoinRows = joinData.filter(joinRow => {
            const mainValue = (mainRow[`${joinCondition.left.split('.')[0]}.${joinCondition.left.split('.')[1]}`] || mainRow[joinCondition.left.split('.')[1]]);
            const joinValue = (joinRow[`${joinCondition.right.split('.')[0]}.${joinCondition.right.split('.')[1]}`] || joinRow[joinCondition.right.split('.')[1]]);
            return mainValue === joinValue;
        });

        if (matchingJoinRows.length === 0) {
            return [createResultRow(mainRow, null, fields, table, true)];
        }

        return matchingJoinRows.map(joinRow => createResultRow(mainRow, joinRow, fields, table, true));
    });
}

function createResultRow(mainRow, joinRow, fields, table, includeAllMainFields) {
    const resultRow = {};

    if (includeAllMainFields) {
        // Include all fields from the main table
        Object.keys(mainRow || {}).forEach(key => {
            const prefixedKey = `${table}.${key}`;
            resultRow[prefixedKey] = mainRow ? mainRow[key] : null;
        });
    }

    // Now, add or overwrite with the fields specified in the query
    fields.forEach(field => {
        const [tableName, fieldName] = field.includes('.') ? field.split('.') : [table, field];
        resultRow[field] = tableName === table && mainRow ? mainRow[fieldName] : joinRow ? joinRow[fieldName] : null;
    });

    return resultRow;
}

function performRightJoin(data, joinData, joinCondition, fields, table) {
    // Cache the structure of a main table row (keys only)
    const mainTableRowStructure = data.length > 0 ? Object.keys(data[0]).reduce((acc, key) => {
        acc[key] = null; // Set all values to null initially
        return acc;
    }, {}) : {};

    return joinData.map(joinRow => {
        const mainRowMatch = data.find(mainRow => {
            const mainValue = mainRow[`${joinCondition.left.split('.')[0]}.${joinCondition.left.split('.')[1]}`] || mainRow[`${joinCondition.left.split('.')[1]}`];
            const joinValue = joinRow[`${joinCondition.right.split('.')[0]}.${joinCondition.right.split('.')[1]}`] || joinRow[`${joinCondition.right.split('.')[1]}`];
            return mainValue === joinValue;
        });

        // Use the cached structure if no match is found
        const mainRowToUse = mainRowMatch || mainTableRowStructure;

        // Include all necessary fields from the 'student' table
        return createResultRow(mainRowToUse, joinRow, fields, table, true);
    });
}

async function executeSELECTQuery(query) {
    const { fields, table, whereClauses, joinType, joinTable, joinCondition, groupByFields, hasAggregateWithoutGroupBy } = parseQuery(query);
    let data = await readCSV(`${table}.csv`);

    if (joinTable && joinCondition) {
        const joinData = await readCSV(`${joinTable}.csv`);
        switch (joinType.toUpperCase()) {
            case 'INNER':
                data = performInnerJoin(data, joinData, joinCondition, fields, table);
                break;
            case 'LEFT':
                data = performLeftJoin(data, joinData, joinCondition, fields, table);
                break;
            case 'RIGHT':
                data = performRightJoin(data, joinData, joinCondition, fields, table);
                break;
            default:
                throw new Error(`Unsupported JOIN type: ${joinType}`);
        }
    }

    // Apply WHERE clause filtering
    const filteredData = whereClauses.length > 0
        ? data.filter(row => whereClauses.every(clause => evaluateCondition(row, clause)))
        : data;

    let groupResults = filteredData;
    if (hasAggregateWithoutGroupBy) {
        // Special handling for queries like 'SELECT COUNT(*) FROM table'
        const result = {};

        fields.forEach(field => {
            const match = /(\w+)\((\*|\w+)\)/.exec(field);
            if (match) {
                const [, aggFunc, aggField] = match;
                switch (aggFunc.toUpperCase()) {
                    case 'COUNT':
                        result[field] = filteredData.length;
                        break;
                    case 'SUM':
                        result[field] = filteredData.reduce((acc, row) => acc + parseFloat(row[aggField]), 0);
                        break;
                    case 'AVG':
                        result[field] = filteredData.reduce((acc, row) => acc + parseFloat(row[aggField]), 0) / filteredData.length;
                        break;
                    case 'MIN':
                        result[field] = Math.min(...filteredData.map(row => parseFloat(row[aggField])));
                        break;
                    case 'MAX':
                        result[field] = Math.max(...filteredData.map(row => parseFloat(row[aggField])));
                        break;

                }
            }
        });

        return [result];
    } else if (groupByFields) {
        groupResults = applyGroupBy(filteredData, groupByFields, fields);
        return groupResults;
    }
    else {
        // Select the specified fields
        return filteredData.map(row => {
            const selectedRow = {};
            fields.forEach(field => {
                selectedRow[field] = row[field];
            });
            return selectedRow;
        });
    }


}

function applyGroupBy(data, groupByFields, aggregateFunctions) {
    const groupedResults = {};

    // Iterate over each row in the data
    data.forEach(row => {
        // Generate a unique key for the group based on groupByFields
        const groupKey = groupByFields.map(field => row[field]).join('-');

        // Initialize group in results if it doesn't exist
        if (!groupedResults[groupKey]) {
            groupedResults[groupKey] = {
                count: 0,
                sums: {},
                mins: {},
                maxes: {}
            };

            // Store groupByFields values in the group
            groupByFields.forEach(field => groupedResults[groupKey][field] = row[field]);
        }

        // Update aggregate calculations for the group
        groupedResults[groupKey].count += 1;

        // Perform aggregate calculations for each aggregate function
        aggregateFunctions.forEach(func => {
            const match = /(\w+)\((\w+)\)/.exec(func);
            if (match) {
                const [, aggFunc, aggField] = match;
                const value = parseFloat(row[aggField]);

                // Apply the appropriate aggregation function using if-else
                if (aggFunc.toUpperCase() === 'SUM') {
                    groupedResults[groupKey].sums[aggField] = (groupedResults[groupKey].sums[aggField] || 0) + value;
                } else if (aggFunc.toUpperCase() === 'MIN') {
                    groupedResults[groupKey].mins[aggField] = Math.min(groupedResults[groupKey].mins[aggField] || value, value);
                } else if (aggFunc.toUpperCase() === 'MAX') {
                    groupedResults[groupKey].maxes[aggField] = Math.max(groupedResults[groupKey].maxes[aggField] || value, value);
                }
                // Additional aggregate functions can be added here using if-else
            }
        });
    });

    // Convert grouped results into an array format
    return Object.values(groupedResults).map(group => {
        // Construct the final grouped object based on required fields
        const finalGroup = {};
        groupByFields.forEach(field => finalGroup[field] = group[field]);

        // Compute the aggregated values for each aggregate function
        aggregateFunctions.forEach(func => {
            const match = /(\w+)\((\*|\w+)\)/.exec(func);
            if (match) {
                const [, aggFunc, aggField] = match;
                if (aggFunc.toUpperCase() === 'SUM') {
                    finalGroup[func] = group.sums[aggField];
                } else if (aggFunc.toUpperCase() === 'MIN') {
                    finalGroup[func] = group.mins[aggField];
                } else if (aggFunc.toUpperCase() === 'MAX') {
                    finalGroup[func] = group.maxes[aggField];
                } else if (aggFunc.toUpperCase() === 'COUNT') {
                    finalGroup[func] = group.count;
                }
                // Additional aggregate functions can be handled here using if-else
            }
        });

        return finalGroup;
    });
}


function evaluateCondition(row, clause) {
    let { field, operator, value } = clause;

    // Check if the field exists in the row
    if (row[field] === undefined) {
        throw new Error(`Invalid field: ${field}`);
    }

    // Parse row value and condition value based on their actual types
    const rowValue = parseValue(row[field]);
    let conditionValue = parseValue(value);

    // console.log("EVALUATING", rowValue, operator, conditionValue, typeof (rowValue), typeof (conditionValue));

    switch (operator) {
        case '=': return rowValue === conditionValue;
        case '!=': return rowValue !== conditionValue;
        case '>': return rowValue > conditionValue;
        case '<': return rowValue < conditionValue;
        case '>=': return rowValue >= conditionValue;
        case '<=': return rowValue <= conditionValue;
        default: throw new Error(`Unsupported operator: ${operator}`);
    }
}

// Helper function to parse value based on its apparent type
function parseValue(value) {

    // Return null or undefined as is
    if (value === null || value === undefined) {
        return value;
    }

    // If the value is a string enclosed in single or double quotes, remove them
    if (typeof value === 'string' && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) {
        value = value.substring(1, value.length - 1);
    }

    // Check if value is a number
    if (!isNaN(value) && value.trim() !== '') {
        return Number(value);
    }
    // Assume value is a string if not a number
    return value;
}

module.exports = executeSELECTQuery;