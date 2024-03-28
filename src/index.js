const parseQuery = require('./queryParser');
const readCSV = require('./csvReader');

async function executeSELECTQuery(query) {
    const { fields, table, whereClauses, joinTable, joinCondition } = parseQuery(query);
    let data = await readCSV(`${table}.csv`);

    // Perform INNER JOIN if specified
    if (joinTable && joinCondition) {
        const joinData = await readCSV(`${joinTable}.csv`);
        data = data.flatMap(mainRow => {
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


    // Apply WHERE clause filtering
    const filteredData = whereClauses.length > 0
        ? data.filter(row => whereClauses.every(clause => evaluateCondition(row, clause)))
        : data;

    // Select the specified fields
    return filteredData.map(row => {
        const selectedRow = {};
        fields.forEach(field => {
            selectedRow[field] = row[field];
        });
        return selectedRow;
    });
}

function evaluateCondition(row, clause) {
    const { field, operator, value } = clause;
    switch (operator) {
        case '=': return row[field] === value;
        case '!=': return row[field] !== value;
        case '>': return row[field] > value;
        case '<': return row[field] < value;
        case '>=': return row[field] >= value;
        case '<=': return row[field] <= value;
        default: throw new Error(`Unsupported operator: ${operator}`);
    }
}

module.exports = executeSELECTQuery;