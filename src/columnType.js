module.exports = function(column) {
    let res = null;
    switch(column.type) {
        case 'int':
        case 'bigint':
        case 'money':
        case 'float':
        case 'smallint':
        case 'real':
            res = 'number';
            break;
        case 'bit':
            res = 'boolean';
            break;
        case 'nchar':
        case 'nvarchar':
        case 'varchar':
            res = 'string';
            break;
        case 'date':
        case 'timestamp':
        case 'datetime':
        case 'datetime2':
            res = 'Date';
            break;
        case 'uniqueidentifier':
            res = 'string';
            break;
        case 'varbinary':
            res = 'Buffer';
            break;
        default:
            break;
    }
    return res;
};
