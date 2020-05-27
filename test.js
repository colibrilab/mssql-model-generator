// import module
const {MsSqlModelGenerator} = require('./src/msSqlModelGenerator');

const run = async () => {

    // create a generator
    const generator = new MsSqlModelGenerator();

    // getting the database model
    const model = await generator.getModel({
        host: 'server',
        database: 'test',
        user: 'sa',
        password: '123',
        port: 1433, // optional
    });

    // configuration for generating TypeOrm entities
    const config = {
        tCities: {
            tUsers: {
                name: 'User',
            },
            tRoleUsers: {
                name: 'RoleUser',
            },
            tRoles: {
                name: 'Role'
            }
        }
    };

    // generating TypeOrm entities in the 'entity' directory
    await generator.createTypeOrmEntities({
        dir: 'entity',
        model: model,
        config: config,
    });
};

run().then(() => {
    console.log('ok.');
});
