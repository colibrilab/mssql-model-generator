## Module functions

1. Getting the MSSQL database model (getModel);
2. Generation of TypeOrm model files (createTypeOrmEntities);


## Examples of using

```javascript
// import module
const {MsSqlModelGenerator} = require('./src/msSqlModelGenerator');

const run = async () => {

    // generator creation
    const generator = new ModelGenerator();

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
        tUsers: {
            name: 'User',
        },
        tRoleUsers: {
            name: 'RoleUser',
        },
        tRoles: {
            name: 'Role'
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
```
    

Let's say that there are two tables [tRoles] and [tUsers] in the database,
related among themselves using the third table [tRoleUsers]:

    ...
        tRoles:
            id: int
            name: nvarchar(100)
    
        tRoleUsers:
            id: int
            roleId: int
            userId: int
    
        tUsers:
            id: int
            name: nvarchar(100)
    ...
    
In order for the files with the description of the tables to be generated,
it is necessary to describe them in config:
```javascript
const config = {
    tUsers: {
        name: 'User',
    },
    tRoleUsers: {
        name: 'RoleUser',
    },
    tRoles: {
        name: 'Role'
    }
};
````

Result:
```javascript
// Role.ts
import ...

@Entity('tRoles', {schema: 'dbo'})
export class Role {

    @PrimaryGeneratedColumn('int')
    id: number;

    @OneToMany(type => RoleUser, RoleUser => RoleUser.Role)
    RoleUsers: RoleUser[];

    @Column('nvarchar', {length: 100})
    name: string;
}

// User.ts
import ...

@Entity('tUsers', {schema: 'dbo'})
export class User {

    @PrimaryGeneratedColumn('int')
    id: number;

    @OneToMany(type => RoleUser, RoleUser => RoleUser.User)
    RoleUsers: RoleUser[];

    @Column('nvarchar', {length: 100})
    name: string;
}

// RoleUser.ts
import ...

@Entity('tRoleUsers', {schema: 'dbo'})
export class RoleUser {

    @PrimaryGeneratedColumn('int')
    id: number;

    @ManyToOne(type => User, User => User.RoleUsers)
    @JoinColumn({name: 'userId'})
    User: User;

    @ManyToOne(type => Role, Role => Role.RoleUsers)
    @JoinColumn({name: 'roleId'})
    Role: Role;
}
```


You can change the names of the columns:
```javascript
const config = {
    tUsers: {
        columns: {
            name: 'ExtName'
        },
    },
};
```

Result:
```javascript
// User.ts
import ...

@Entity('tUsers', {schema: 'dbo'})
export class User {

    @PrimaryGeneratedColumn('int')
    id: number;

    @OneToMany(type => RoleUser, RoleUser => RoleUser.User)
    RoleUsers: RoleUser[];

    @Column('nvarchar', {length: 100})
    ExtName: string; // <---
}
```


Suppose there is a table in which the column names begin with capital
letters and you need to convert the names so that they begin with a
lowercase letter. You can use the [columns] option described above.
But if this conversion needs to be performed for all columns of the table,
then it is more convenient to use the option [lowercase].

```javascript
const config = {
    tUsers: {
        lowercase: true,
    },
};
```    


Column names in ManyToOne and OneToMany relationships will be
generated automatically, but sometimes you need to change them:

```javascript
const config = {
    tUsers: {
        name: 'User',
    },
    tRoleUsers: {
        name: 'RoleUser',
        manyToOne: {
            userId: ['AAA', 'BBB']  // <---
        },
    },
    tRoles: {
        name: 'Role'
    }
};
```
    
Result:
```javascript
// Role.ts
import ...

@Entity('tRoles', {schema: 'dbo'})
export class Role {

    @PrimaryGeneratedColumn('int')
    id: number;

    @OneToMany(type => RoleUser, RoleUser => RoleUser.Role)
    RoleUsers: RoleUser[];

    @Column('nvarchar', {length: 100})
    name: null;
}

// User.ts
import ...

@Entity('tUsers', {schema: 'dbo'})
export class User {

    @PrimaryGeneratedColumn('int')
    id: number;

    @OneToMany(type => RoleUser, RoleUser => RoleUser.AAA)
    BBB: RoleUser[]; // <---

    @Column('nvarchar', {length: 100})
    name: string;
}

// RoleUser.ts
import ...

@Entity('tRoleUsers', {schema: 'dbo'})
export class RoleUser {

    @PrimaryGeneratedColumn('int')
    id: number;

    @ManyToOne(type => User, User => User.BBB)
    @JoinColumn({name: 'userId'})
    AAA: User; // <---

    @ManyToOne(type => Role, Role => Role.RoleUsers)
    @JoinColumn({name: 'roleId'})
    Role: Role;
}
```

    
If you want to make a bunch of ManyToMany, then config should be modified as follows:
```javascript
const config = {
    tUsers: {
        name: 'User'
    },
    tRoleUsers: {
        name: 'RoleUser',
        manyToMany: [
            ['roleId', 'AAA'], // <---
            ['userId', 'BBB'], // <---
        ]
    },
    tRoles: {
        name: 'Role'
    }
};
```

Result:
```javascript
// Role.ts
import ...

@Entity('tRoles', {schema: 'dbo'})
export class Role {

    @PrimaryGeneratedColumn('int')
    id: number;

    @Column('nvarchar', {length: 100})
    name: null;

    @ManyToMany(type => User)
    @JoinTable({
        name: 'RoleUser',
        joinColumns: [{name: 'roleId', referencedColumnName: 'id'}],
        inverseJoinColumns: [{name: 'userId', referencedColumnName: 'id'}],
    })
    BBB: User[]; // <---
}

// User.ts
import ...

@Entity('tUsers', {schema: 'dbo'})
export class User {

    @PrimaryGeneratedColumn('int')
    id: number;

    @Column('nvarchar', {length: 100})
    name: string;

    @ManyToMany(type => Role)
    @JoinTable({
        name: 'RoleUser',
        joinColumns: [{name: 'userId', referencedColumnName: 'id'}],
        inverseJoinColumns: [{name: 'roleId', referencedColumnName: 'id'}],
    })
    AAA: Role[]; // <---
}

// RoleUser.ts
import ...

@Entity('tRoleUsers', {schema: 'dbo'})
export class RoleUser {

    @PrimaryGeneratedColumn('int')
    id: number;

    @Column('int')
    userId: number;

    @Column('int')
    roleId: number;
}
```
