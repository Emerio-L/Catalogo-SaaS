const { prisma } = require('./db');
const crypto = require('crypto');

// Helper to validate both legacy MongoDB ObjectIds (24 chars) and PostgreSQL UUIDs (36 chars)
function isValidId(id) {
    return typeof id === 'string' && (id.length === 24 || id.length === 36);
}

// Convert Prisma Decimal objects to standard JavaScript numbers
function convertDecimalsToNumbers(modelName, data) {
    if (!data) return;
    const decimalFields = {
        Plan: ['monthlyPrice'],
        Tenant: ['monthlyPrice'],
        Product: ['precio'],
        Order: ['total'],
        OrderItem: ['precio'],
        Payment: ['amount'],
        SaasSettings: ['monthlyPrice']
    };

    const fields = decimalFields[modelName];
    if (fields) {
        fields.forEach(field => {
            if (data[field] !== undefined && data[field] !== null) {
                data[field] = Number(data[field]);
            }
        });
    }
}

// Helper to map Mongo queries to Prisma where conditions
function mapQuery(modelName, mongoQuery) {
    if (!mongoQuery || typeof mongoQuery !== 'object') return {};

    const prismaWhere = {};

    // Handle soft deletes for Product and Category
    if (modelName === 'Product' || modelName === 'Category') {
        prismaWhere.deletedAt = null;
    }

    for (const [key, value] of Object.entries(mongoQuery)) {
        if (key === 'tenantId' && value && typeof value === 'object' && value.$exists === false) {
            prismaWhere.tenantId = 'non-existent-tenant-id';
            continue;
        }

        if (key === '_id') {
            prismaWhere.id = value;
        } else if (key === '$or') {
            prismaWhere.OR = value.map(q => mapQuery(modelName, q));
        } else if (key === '$and') {
            prismaWhere.AND = value.map(q => mapQuery(modelName, q));
        } else if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
            const subQuery = {};
            for (const [op, val] of Object.entries(value)) {
                if (op === '$ne') {
                    subQuery.not = val;
                } else if (op === '$in') {
                    subQuery.in = val;
                } else if (op === '$nin') {
                    subQuery.notIn = val;
                } else if (op === '$gt') {
                    subQuery.gt = val;
                } else if (op === '$gte') {
                    subQuery.gte = val;
                } else if (op === '$lt') {
                    subQuery.lt = val;
                } else if (op === '$lte') {
                    subQuery.lte = val;
                } else if (op === '$exists') {
                    if (val === false) {
                        subQuery.equals = null;
                    }
                } else {
                    subQuery[op] = val;
                }
            }
            prismaWhere[key] = subQuery;
        } else {
            prismaWhere[key] = value;
        }
    }

    return prismaWhere;
}

// Helper to map Mongoose sort syntax to Prisma orderBy
function mapSort(sortOption) {
    if (!sortOption) return undefined;

    if (typeof sortOption === 'string') {
        const parts = sortOption.trim().split(/\s+/);
        const orderBy = {};
        parts.forEach(part => {
            if (part.startsWith('-')) {
                orderBy[part.substring(1)] = 'desc';
            } else {
                orderBy[part] = 'asc';
            }
        });
        return orderBy;
    }

    if (typeof sortOption === 'object') {
        if (Array.isArray(sortOption)) {
            return sortOption.map(mapSort);
        }
        const orderBy = [];
        for (const [key, value] of Object.entries(sortOption)) {
            orderBy.push({
                [key]: value === -1 || value === 'desc' ? 'desc' : 'asc'
            });
        }
        return orderBy.length === 1 ? orderBy[0] : orderBy;
    }

    return undefined;
}

// Post-processes populate fields to mimic Mongoose's nested populated objects
function postProcessPopulate(modelName, doc, populateCalls) {
    if (!doc) return;
    populateCalls.forEach(call => {
        const path = call.path;
        if (path === 'planId' && doc.plan) {
            doc.planId = makeDocument('Plan', doc.plan);
            delete doc.plan;
        } else if (path === 'categoriaId' && doc.category) {
            doc.categoriaId = makeDocument('Category', doc.category);
            delete doc.category;
        } else if (path === 'approvedBy' && doc.approvedBy) {
            doc.approvedBy = makeDocument('User', doc.approvedBy);
        } else if (path === 'changedBy' && doc.changedBy) {
            doc.changedBy = makeDocument('User', doc.changedBy);
        } else if (path === 'tenantId' && doc.tenant) {
            doc.tenantId = makeDocument('Tenant', doc.tenant);
            delete doc.tenant;
        }
    });
}

// Mimics a Mongoose query object (thenable)
class QueryCompat {
    constructor(modelName, executor) {
        this.modelName = modelName;
        this.executor = executor;
        this.populateCalls = [];
        this.sortCalls = [];
        this.isLean = false;
    }

    populate(path, select) {
        if (typeof path === 'string') {
            this.populateCalls.push({ path, select });
        } else if (path && typeof path === 'object') {
            this.populateCalls.push(path);
        }
        return this;
    }

    sort(order) {
        this.sortCalls.push(order);
        return this;
    }

    lean() {
        this.isLean = true;
        return this;
    }

    then(onfulfilled, onrejected) {
        return this.exec().then(onfulfilled, onrejected);
    }

    async exec() {
        return this.executor(this);
    }
}

// Creates a Mongoose-like document wrapper
function makeDocument(modelName, data, isNew = false) {
    if (!data) return null;

    const doc = { ...data };

    doc._id = data.id || data._id;
    doc.id = doc._id;

    convertDecimalsToNumbers(modelName, doc);

    if (modelName === 'Order' && data.productos) {
        doc.productos = data.productos.map(p => {
            convertDecimalsToNumbers('OrderItem', p);
            return p;
        });
    }

    doc.$isNew = isNew;

    doc.save = async function() {
        const prismaModel = modelName.charAt(0).toLowerCase() + modelName.slice(1);
        const dataToSave = { ...this };
        delete dataToSave.save;
        delete dataToSave.toObject;
        delete dataToSave._id;
        delete dataToSave.id;
        delete dataToSave.$isNew;

        // Skip nested relations
        delete dataToSave.productos; 
        delete dataToSave.users;
        delete dataToSave.settings;
        delete dataToSave.categories;
        delete dataToSave.products;
        delete dataToSave.orders;
        delete dataToSave.payments;
        delete dataToSave.sessions;
        delete dataToSave.passwordResetTokens;
        delete dataToSave.accountStatusLogs;
        delete dataToSave.auditLogs;
        delete dataToSave.approvedPayments;
        delete dataToSave.changedStatusLogs;

        if (this.$isNew) {
            if (modelName === 'Order' && this.productos) {
                const createdOrder = await prisma.order.create({
                    data: {
                        ...dataToSave,
                        productos: {
                            create: this.productos.map(p => ({
                                nombre: p.nombre,
                                precio: p.precio,
                                cantidad: p.cantidad,
                                unidad: p.unidad
                            }))
                        }
                    },
                    include: {
                        productos: true
                    }
                });
                Object.assign(this, createdOrder);
            } else {
                const created = await prisma[prismaModel].create({
                    data: {
                        ...dataToSave,
                        id: this.id
                    }
                });
                Object.assign(this, created);
            }
            this.$isNew = false;
        } else {
            const updated = await prisma[prismaModel].update({
                where: { id: this.id },
                data: dataToSave
            });
            Object.assign(this, updated);
        }

        convertDecimalsToNumbers(modelName, this);
        this._id = this.id;
        return this;
    };

    doc.toObject = function() {
        const obj = { ...this };
        delete obj.save;
        delete obj.toObject;
        delete obj.$isNew;
        return obj;
    };

    return doc;
}

// Builds the Model compat wrapper
function makeModel(modelName, prismaModelName) {
    const ModelConstructor = function(data) {
        return makeDocument(modelName, {
            id: data.id || data._id || crypto.randomUUID(),
            ...data
        }, true);
    };

    ModelConstructor.find = function(mongoQuery = {}) {
        return new QueryCompat(modelName, async (queryObj) => {
            const where = mapQuery(modelName, mongoQuery);
            const prismaArgs = { where };

            const include = {};
            queryObj.populateCalls.forEach(call => {
                if (call.path === 'planId') include.plan = true;
                if (call.path === 'categoriaId') include.category = true;
                if (call.path === 'approvedBy') include.approvedBy = true;
                if (call.path === 'changedBy') include.changedBy = true;
                if (call.path === 'tenantId') include.tenant = true;
            });

            if (modelName === 'Order') {
                include.productos = true;
            }

            if (Object.keys(include).length > 0) {
                prismaArgs.include = include;
            }

            if (queryObj.sortCalls.length > 0) {
                prismaArgs.orderBy = mapSort(queryObj.sortCalls[0]);
            }

            const results = await prisma[prismaModelName].findMany(prismaArgs);
            return results.map(item => {
                const doc = makeDocument(modelName, item);
                postProcessPopulate(modelName, doc, queryObj.populateCalls);
                return doc;
            });
        });
    };

    ModelConstructor.findOne = function(mongoQuery = {}) {
        return new QueryCompat(modelName, async (queryObj) => {
            const where = mapQuery(modelName, mongoQuery);
            const prismaArgs = { where };

            const include = {};
            queryObj.populateCalls.forEach(call => {
                if (call.path === 'planId') include.plan = true;
                if (call.path === 'categoriaId') include.category = true;
                if (call.path === 'approvedBy') include.approvedBy = true;
                if (call.path === 'changedBy') include.changedBy = true;
                if (call.path === 'tenantId') include.tenant = true;
            });

            if (modelName === 'Order') {
                include.productos = true;
            }

            if (Object.keys(include).length > 0) {
                prismaArgs.include = include;
            }

            if (queryObj.sortCalls.length > 0) {
                prismaArgs.orderBy = mapSort(queryObj.sortCalls[0]);
            }

            const result = await prisma[prismaModelName].findFirst(prismaArgs);
            if (!result) return null;

            const doc = makeDocument(modelName, result);
            postProcessPopulate(modelName, doc, queryObj.populateCalls);
            return doc;
        });
    };

    ModelConstructor.findById = function(id) {
        if (!id) return new QueryCompat(modelName, async () => null);
        return ModelConstructor.findOne({ _id: id.toString() });
    };

    ModelConstructor.create = async function(data) {
        const doc = makeDocument(modelName, {
            id: data.id || data._id || crypto.randomUUID(),
            ...data
        }, true);
        await doc.save();
        return doc;
    };

    ModelConstructor.insertMany = async function(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return [];
        const createdDocs = [];
        for (const item of arr) {
            const created = await ModelConstructor.create(item);
            createdDocs.push(created);
        }
        return createdDocs;
    };


    ModelConstructor.updateOne = async function(mongoQuery, updateObj) {
        const where = mapQuery(modelName, mongoQuery);
        const updateData = updateObj.$set || updateObj;
        
        const records = await prisma[prismaModelName].findMany({ where });
        if (records.length === 0) {
            if (updateObj.$setOnInsert) {
                const combined = { ...updateObj.$setOnInsert, ...updateObj.$set };
                return ModelConstructor.create(combined);
            }
            return { matchedCount: 0, modifiedCount: 0 };
        }

        const cleanData = {};
        for (const [k, v] of Object.entries(updateData)) {
            if (!k.startsWith('$') && k !== 'tenantId') {
                cleanData[k] = v;
            }
        }

        await prisma[prismaModelName].update({
            where: { id: records[0].id },
            data: cleanData
        });
        return { matchedCount: 1, modifiedCount: 1 };
    };

    ModelConstructor.updateMany = async function(mongoQuery, updateObj) {
        const where = mapQuery(modelName, mongoQuery);
        const updateData = updateObj.$set || updateObj;

        const cleanData = {};
        for (const [k, v] of Object.entries(updateData)) {
            if (!k.startsWith('$')) {
                cleanData[k] = v;
            }
        }

        const result = await prisma[prismaModelName].updateMany({
            where,
            data: cleanData
        });
        return { matchedCount: result.count, modifiedCount: result.count };
    };

    ModelConstructor.deleteOne = async function(mongoQuery) {
        const where = mapQuery(modelName, mongoQuery);
        const record = await prisma[prismaModelName].findFirst({ where });
        if (!record) return { deletedCount: 0 };

        if (modelName === 'Product' || modelName === 'Category') {
            await prisma[prismaModelName].update({
                where: { id: record.id },
                data: { deletedAt: new Date() }
            });
        } else {
            await prisma[prismaModelName].delete({
                where: { id: record.id }
            });
        }
        return { deletedCount: 1 };
    };

    ModelConstructor.deleteMany = async function(mongoQuery) {
        const where = mapQuery(modelName, mongoQuery);
        if (modelName === 'Product' || modelName === 'Category') {
            const result = await prisma[prismaModelName].updateMany({
                where,
                data: { deletedAt: new Date() }
            });
            return { deletedCount: result.count };
        } else {
            const result = await prisma[prismaModelName].deleteMany({
                where
            });
            return { deletedCount: result.count };
        }
    };

    ModelConstructor.findOneAndUpdate = async function(mongoQuery, updateObj, options = {}) {
        const where = mapQuery(modelName, mongoQuery);
        const updateData = updateObj.$set || updateObj.$setOnInsert || updateObj;

        const cleanData = {};
        for (const [k, v] of Object.entries(updateData)) {
            if (!k.startsWith('$')) cleanData[k] = v;
        }

        const record = await prisma[prismaModelName].findFirst({ where });
        if (!record) {
            if (options.upsert) {
                const combined = { ...updateObj.$setOnInsert, ...updateObj.$set };
                return ModelConstructor.create(combined);
            }
            return null;
        }

        const updated = await prisma[prismaModelName].update({
            where: { id: record.id },
            data: cleanData
        });
        return makeDocument(modelName, updated);
    };

    ModelConstructor.findOneAndDelete = async function(mongoQuery) {
        const where = mapQuery(modelName, mongoQuery);
        const record = await prisma[prismaModelName].findFirst({ where });
        if (!record) return null;

        if (modelName === 'Product' || modelName === 'Category') {
            await prisma[prismaModelName].update({
                where: { id: record.id },
                data: { deletedAt: new Date() }
            });
        } else {
            await prisma[prismaModelName].delete({
                where: { id: record.id }
            });
        }
        return makeDocument(modelName, record);
    };

    ModelConstructor.countDocuments = async function(mongoQuery = {}) {
        const where = mapQuery(modelName, mongoQuery);
        return prisma[prismaModelName].count({ where });
    };

    ModelConstructor.exists = async function(mongoQuery = {}) {
        const where = mapQuery(modelName, mongoQuery);
        const count = await prisma[prismaModelName].count({ where });
        return count > 0;
    };

    return ModelConstructor;
}

module.exports = {
    Tenant: makeModel('Tenant', 'tenant'),
    Category: makeModel('Category', 'category'),
    Producto: makeModel('Product', 'product'),
    Settings: makeModel('Settings', 'settings'),
    Pedido: makeModel('Order', 'order'),
    User: makeModel('User', 'user'),
    Session: makeModel('Session', 'session'),
    PasswordResetToken: makeModel('PasswordResetToken', 'passwordResetToken'),
    AuditLog: makeModel('AuditLog', 'auditLog'),
    Plan: makeModel('Plan', 'plan'),
    Payment: makeModel('Payment', 'payment'),
    AccountStatusLog: makeModel('AccountStatusLog', 'accountStatusLog'),
    SaasSettings: makeModel('SaasSettings', 'saasSettings'),
    isPrisma: true,
    isValidId,
    prisma
};
