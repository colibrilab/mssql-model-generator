const _ = require('lodash');
const fs = require('graceful-fs-extra');
const path = require('path');
const typeorm = require('typeorm');
const pluralise = require('mypluralize');
const mkdirp = require('mkdirp');
const columnType = require('./columnType');
const columnDefinition = require('./columnDefinition');

class MsSqlModelGenerator {

    async getModel({connection, host, port, database, username, password}) {

        let con = connection;
        let manager;
        if (!con) {
            const connectionOptions = {
                type: 'mssql',
                host: host,
                port: port || 1433,
                database: database,
                username: username,
                password: password,
                synchronize: false,
                logging: false,
                enableArithAbort: true,
            };
            con = typeorm.getConnectionManager().create(connectionOptions);
            manager = (await con.connect()).manager;
        }
        else {
            manager = connection.manager;
        }

        let data;
        let model = [];

        const query = async function(query) {
            return (await manager.query(query));
        };

        const getTable = function(tableName) {
            return _.find(model, o => o.name === tableName);
        };

        const getColumn = function(tableName, columnName) {
            const table = getTable(tableName);
            return _.find(table.columns, o => o.name === columnName)
        };

        // tables
        data = await query(`
            select t.table_schema as [schema], so.name as name, sp.value as description
                from information_schema.tables t
                inner join sysobjects so on so.name = t.table_name
                left join sys.extended_properties sp on sp.major_id = so.id and sp.minor_id = 0
                where t.table_name <> 'sysdiagrams' and t.table_type <> 'VIEW'
        `);

        for(let row of data) {
            model.push({
                schema: row.schema,
                name: row.name,
                description: row.description,
                columns: [],
            });
        }

        // columns
        data = await query(`
            select
                st.name as [table],
                cl.ordinal_position as [order],
                cl.column_Name as [name],
                sep.value as [description],
                cl.data_type as [type],
                cl.numeric_precision as [precision],
                cl.numeric_scale as [scale],
                cl.character_maximum_length as [length],
                (case cl.is_nullable when 'YES' then 1 else 0 end) as [nullable],
                cl.column_default as [default],
                cc.definition as [computed]
            from sys.tables st
            inner join sys.columns sc on st.object_id = sc.object_id
            inner join information_schema.columns cl on cl.table_name = st.name and cl.column_name = sc.name
            left join sys.extended_properties sep on st.object_id = sep.major_id and sc.column_id = sep.minor_id and sep.name = 'MS_Description'
            left join sys.computed_columns cc on cc.object_id = st.object_id and cc.column_id = sc.column_id
            where st.name <> 'sysdiagrams'
            order by st.name, cl.ordinal_position
        `);

        for(let row of data) {
            const table = getTable(row.table);
            table.columns.push({
                name: row.name,
                order: row.order,
                description: row.description,
                primary: false,
                identity: false,
                type: row.type,
                precision: row.precision,
                scale: row.scale,
                length: row.length,
                nullable: row.nullable,
                default: row.default,
                computed: row.computed,
                oneToMany: [],
                manyToOne: null,
            });
        }

        // primary
        data = await query(`
            select pk.table_name as [table], c.column_name as [column]
                from information_schema.table_constraints pk 
                inner join information_schema.key_column_usage c on c.table_name = pk.table_name  and c.constraint_name = pk.constraint_name
                where constraint_type = 'primary key' and pk.table_name <> 'sysdiagrams'
        `);

        for(let row of data) {
            const column = getColumn(row.table, row.column);
            column.primary = true;
        }

        // identity
        data = await query(`
            select object_name(object_id) as [table], name AS [column]
                from sys.identity_columns
                where object_schema_name(object_id) <> 'sys' and object_name(object_id) <> 'sysdiagrams'
        `);

        for(let row of data) {
            const column = getColumn(row.table, row.column);
            column.identity = true;
        }

        // relationship
        data = await query(`
            select 
                object_name(f.parent_object_id) as [table],
                col_name(fc.parent_object_id, fc.parent_column_id) as [column],
                object_name(f.referenced_object_id) as refTable,
                col_name(fc.referenced_object_id, fc.referenced_column_id) as refColumn
                from sys.foreign_keys as f
                inner join sys.foreign_key_columns as fc on f.object_id = fc.constraint_object_id
                inner join sys.objects as o on o.object_id = fc.referenced_object_id
        `);

        for(let row of data) {
            const column = getColumn(row.table, row.column);
            const refColumn = getColumn(row.refTable, row.refColumn);
            column.manyToOne = {
                table: row.refTable,
                column: row.refColumn
            };
            refColumn.oneToMany.push({
                table: row.table,
                column: row.column
            });
        }

        if (!connection) {
            con.close();
        }

        return model;
    }

    async createTypeOrmEntities({dir, model, config, swagger = false}) {

        const extModel = _.clone(model);
        const extConfig = {};
        const names = {};

        function getNewTableName(tableName) {
            return config[tableName] && config[tableName].name
                ? config[tableName].name
                : tableName;
        }

        function getNewColumnName(tableName, columnName) {
            const lowercase = config[tableName] && config[tableName]['lowercase'] ? config[tableName]['lowercase'] : false;
            return config[tableName] && config[tableName]['columns'] && config[tableName]['columns'][columnName]
                ? config[tableName].columns[columnName]
                : (lowercase ? columnName.substr(0, 1).toLowerCase() + columnName.substr(1) : columnName);
        }

        function getTable(tableName) {
            return _.find(extModel, o => o.name === tableName);
        }

        function getColumn(tableName, columnName) {
            const table = getTable(tableName);
            return _.find(table.columns, o => o.name.toLowerCase() === columnName.toLowerCase())
        }

        function getFreeColumnName(tableName, columnName) {
            let n = 1;
            while (names[tableName][n === 1 ? columnName : columnName + n]) {
                n++;
            }
            let freeName = n === 1 ? columnName : columnName + n;
            names[tableName][freeName] = true;
            return freeName;
        }

        // prepare extModel, names and extConfig
        for (const table of extModel) {
            table.entity = table.name;
            table.name = getNewTableName(table.entity);
            table.manyToMany = [];

            // add only those tables that are in config
            if (config[table.entity]) {
                names[table.name] = {};

                for (const column of table.columns) {
                    names[table.name][column.name] = true;
                    for (const otm of column.oneToMany) {
                        otm.table = getNewTableName(otm.table);
                    }
                    if (column.manyToOne) {
                        column.manyToOne.table = getNewTableName(column.manyToOne.table);
                    }
                }
            }

            extConfig[getNewTableName(table.name)] = config[table.entity] ? config[table.entity] : {};
        }

        // prepare relationship manyToMany
        for (const table of extModel) {
            if (extConfig[table.name].manyToMany) {

                const mtm = extConfig[table.name].manyToMany;

                if (mtm.length !== 2) {
                    throw new Error(`Failed to create ManyToMany relationship to table [${table.entity}]: The table configuration should contain a description of two ManyToMany relationships.`);
                }

                const cn0 = mtm[0][0];
                const c0 = getColumn(table.name, cn0);

                if (!c0.manyToOne) {
                    throw new Error(`Failed to create ManyToMany relationship to table [${table.entity}]: Field [${mtm[0][0]}] has no ManyToOne relationship.`);
                }

                const tn0 = c0.manyToOne.table;
                const t0 = getTable(tn0);

                const cn1 = mtm[1][0];
                const c1 = getColumn(table.name, cn1);

                if (!c1.manyToOne) {
                    throw new Error(`Failed to create ManyToMany relationship to table [${table.entity}]: Field [${mtm[1][0]}] has no ManyToOne relationship.`);
                }

                const tn1 = c1.manyToOne.table;
                const t1 = getTable(tn1);

                const addManyToMany = function (refTable, colName, colType, c0, c1) {
                    refTable.manyToMany.push({
                        name: table.entity,
                        colName: colName,
                        colType: colType,
                        joinColumns: {
                            name: c0.name,
                            referencedColumnName: getNewColumnName(refTable.entity, c0.manyToOne.column),
                        },
                        inverseJoinColumns: {
                            name: c1.name,
                            referencedColumnName: getNewColumnName(table.entity, c1.manyToOne.column),
                        }
                    });
                };

                addManyToMany(t0, mtm[1][1], t1.name, c0, c1);
                addManyToMany(t1, mtm[0][1], t0.name, c1, c0);

                // delete relationship oneToMany
                const ref_c0 = getColumn(c0.manyToOne.table, c0.manyToOne.column);
                const ref_i0 = _.findIndex(ref_c0.oneToMany, o => o.table === table.name && o.column.toLowerCase() === mtm[0][0].toLowerCase());
                ref_c0.oneToMany.splice(ref_i0, 1);

                const ref_c1 = getColumn(c1.manyToOne.table, c1.manyToOne.column);
                const ref_i1 = _.findIndex(ref_c1.oneToMany, o => o.table === table.name && o.column.toLowerCase() === mtm[1][0].toLowerCase());
                ref_c1.oneToMany.splice(ref_i1, 1);

                // delete relationship manyToOne
                c0.manyToOne = null;
                c1.manyToOne = null;
            }
        }

        // prepare relationship oneToMany
        for (const table of extModel) {
            for (const column of table.columns) {
                if (column.manyToOne) {
                    const mto = column.manyToOne;

                    if (names[mto.table]) {
                        const otmTable = getTable(mto.table);
                        const otmColumn = getColumn(mto.table, mto.column);
                        const otm = _.find(otmColumn.oneToMany, o => o.table === table.name && o.column === column.name);

                        let pc, pcn, name, ref_name;

                        if (extConfig[table.name] && extConfig[table.name].manyToOne && extConfig[table.name].manyToOne[column.name]) {
                            let mtoConf = extConfig[table.name].manyToOne[column.name];
                            name = mtoConf[0];
                            ref_name = mtoConf[1];

                            if (names[otm.table][name]) {
                                throw new Error(`The column name specified in the configuration in the 'manyToOne' section conflicts with the existing names: [${table.name}].[${name}].`);
                            }

                            if (names[mto.table][ref_name]) {
                                throw new Error(`The column name specified in the configuration in the 'manyToOne' section conflicts with the existing names: [${table.name}].[${ref_name}].`);
                            }

                            names[otm.table][name] = true;
                            names[mto.table][ref_name] = true;
                        } else {
                            name = getFreeColumnName(otm.table, mto.table);
                            ref_name = getFreeColumnName(mto.table, pluralise.getPlural(otm.table));
                        }

                        mto.name = name;
                        mto.ref_name = ref_name;
                        otm.name = ref_name;
                        otm.ref_name = name;
                    }
                }
            }
        }

        // output
        mkdirp.sync(path.resolve(dir));
        for (const table of extModel) {

            if (names[table.name]) {

                // find out which classes need to be imported
                const importEntities = {};
                const importOrmClasses = { Entity: true };
                const importSwaggerClasses = {};
                for (const column of table.columns) {

                    if (column.manyToOne && names[column.manyToOne.table]) {
                        if (table.name !== column.manyToOne.table) {
                            importEntities[column.manyToOne.table] = true;
                            importOrmClasses.ManyToOne = true;
                        }
                    }
                    for (const otm of column.oneToMany) {
                        if (table.name !== otm.table && names[otm.table]) {
                            importEntities[otm.table] = true;
                            importOrmClasses.OneToMany = true;
                        }
                    }
                }
                for (const mtm of table.manyToMany) {
                    if (table.name !== mtm.table) {
                        importEntities[mtm.colType] = true;
                    }
                }

                // prepare class property output
                let codeProps = '';

                for (const column of table.columns) {

                    const pushSwaggerApi = function(column, type = null) {

                        if (swagger) {
                            if (column.nullable) {
                                if (type) {
                                    codeProps += `\n  @ApiModelPropertyOptional({type: () => ${type}})`;
                                    importSwaggerClasses.ApiModelPropertyOptional = true;
                                }
                                else if (column.description) {
                                    const description = column.description.replace(new RegExp('\'', 'g'), '"');
                                    codeProps += `\n  @ApiModelPropertyOptional({description: '${description}'})`;
                                    importSwaggerClasses.ApiModelPropertyOptional = true;
                                }
                            }
                            else {
                                if (type) {
                                    codeProps += `\n  @ApiModelProperty({type: () => ${type}})`;
                                    importSwaggerClasses.ApiModelProperty = true;
                                }
                                else if (column.description) {
                                    const description = column.description.replace(new RegExp('\'', 'g'), '"');
                                    codeProps += `\n  @ApiModelProperty({description: '${description}'})`;
                                    importSwaggerClasses.ApiModelProperty = true;
                                }
                            }
                        }
                    }

                    // PrimaryGeneratedColumn
                    if (column.primary && column.identity) {
                        pushSwaggerApi(column);
                        codeProps += `\n  @PrimaryGeneratedColumn(${columnDefinition(column)})`;
                        codeProps += `\n  ${getNewColumnName(table.entity, column.name)}: ${columnType(column)};\n`;
                        importOrmClasses.PrimaryGeneratedColumn = true;
                        // PrimaryColumn
                    } else if (column.primary) {
                        pushSwaggerApi(column);
                        codeProps += `\n  @PrimaryColumn(${columnDefinition(column)})`;
                        codeProps += `\n  ${getNewColumnName(table.entity, column.name)}: ${columnType(column)};\n`;
                        importOrmClasses.PrimaryColumn = true;
                    } else {
                        // Column
                        if (!column.manyToOne) {
                            pushSwaggerApi(column);
                            codeProps += `\n  @Column(${columnDefinition(column)})`;
                            codeProps += `\n  ${getNewColumnName(table.entity, column.name)}: ${columnType(column)};\n`;
                            importOrmClasses.Column = true;
                        } else {
                            // ManyToOne
                            if (names[column.manyToOne.table]) {
                                let mto = column.manyToOne;
                                pushSwaggerApi(column, mto.table);
                                codeProps += `\n  @ManyToOne(type => ${mto.table}, ${mto.table} => ${mto.table}.${mto.ref_name})`;
                                codeProps += `\n  @JoinColumn({name: '${getNewColumnName(table.entity, column.name)}'})`;
                                codeProps += `\n  ${mto.name}: ${mto.table};`;
                                codeProps += '\n';
                                importOrmClasses.ManyToOne = true;
                                importOrmClasses.JoinColumn = true;
                            }
                        }
                    }

                    // OneToMany
                    for (const otm of column.oneToMany) {
                        if (names[otm.table]) {
                            // pushSwaggerApi(column, otm.table);
                            codeProps += `\n  @OneToMany(type => ${otm.table}, ${otm.table} => ${otm.table}.${otm.ref_name})`;
                            codeProps += `\n  ${otm.name}: ${otm.table}[];`;
                            codeProps += `\n`;
                            importOrmClasses.OneToMany = true;
                        }
                    }
                }

                for (const mtm of table.manyToMany) {
                    codeProps += `\n  @ManyToMany(type => ${mtm.colType})`;
                    codeProps += `\n  @JoinTable({`;
                    codeProps += `\n    name: '${mtm.name}',`;
                    codeProps += `\n    joinColumns: [{name: '${mtm.joinColumns.name}', referencedColumnName: '${getNewColumnName(mtm.name, mtm.joinColumns.referencedColumnName)}'}],`;
                    codeProps += `\n    inverseJoinColumns: [{name: '${mtm.inverseJoinColumns.name}', referencedColumnName: '${getNewColumnName(mtm.name, mtm.joinColumns.referencedColumnName)}'}],`;
                    codeProps += `\n  })`;
                    codeProps += `\n  ${pluralise.getPlural(mtm.colName)}: ${mtm.colType}[];`;
                    codeProps += `\n`;
                    importOrmClasses.ManyToMany = true;
                    importOrmClasses.JoinTable = true;
                }

                // import section
                let code = '';

                // Import TypeORM
                code += `import {\n`;
                for (const m in importOrmClasses) {
                    code += `  ${m},\n`;
                }
                code += `} from 'typeorm';\n`;

                // Import Swagger Api
                if (!_.isEqual({}, importSwaggerClasses)) {
                    code += `import {\n`;
                    for (const m in importSwaggerClasses) {
                        code += `  ${m},\n`;
                    }
                    code += `} from '@nestjs/swagger/dist/decorators/api-model-property.decorator';\n`;
                }

                // Import Entities
                for (const entity in importEntities) {
                    code += `import {${entity}} from './${entity}';\n`;
                }

                // class header section
                code += '\n';
                code += `@Entity('${table.entity}', {schema: '${table.schema}'})\n`;
                code += `export class ${table.name} {\n`;

                // class properties section
                code += codeProps;
                code += `}\n`;

                // write to file
                const fileName = table.name + '.ts';
                await fs.writeFileSync(path.join(dir, fileName), code, 'utf8');
            }
        }
    }
}

module.exports.MsSqlModelGenerator = MsSqlModelGenerator;