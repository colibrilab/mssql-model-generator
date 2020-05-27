const columnType = require('./columnType');

module.exports = function(column) {

    let props = '';

    function addProp(a, b) {
        props += (props ? ', ' : '') + `${a}: ${b}`;
    }

    addProp('name', `'${column.name}'`);
    addProp('type', `'${column.type}'`);
    if (column.length > 0 && column.type !== 'text') { addProp('length', column.length) }
    if (column.nullable) { addProp('nullable', 'true') }

    return `{${props}}`;
}
