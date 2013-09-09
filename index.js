var Q = require('q')
var through = require('through')
var mongodb = require('mongodb')
var maskurl = require('maskurl')
var quotemeta = require('quotemeta')
var deepClone = require('clone')
var utils = require('./utils')
var charybdis = require('charybdis')

var connection

function Query(db, collection) {
  if (!(this instanceof Query)) {
    return new Query(db, collection)
  }

  this._ = {
    db: db || connection,
    collection: collection,
    query: {},
    projection: null,
    options: {
      safe: true
    }
  }
}

Query.prototype = {
  // query
  clone: clone,
  collection: collection,
  where: where,
  // options
  select: select,
  sort: sort,
  limit: limit,
  skip: skip,
  expect: expect,
  options: options,
  //finalizers
  toArray: toArray,
  one: one,
  deferOne: deferOne,
  deferToArray: deferToArray,
  stream: stream,
  count: count,
  checkExists: checkExists,
  assertExists: assertExists,
  // mutators
  insert: insert,
  update: update,
  findAndModify: findAndModify,
  modifyAndFind: modifyAndFind,
  pull: pull,
  upsert: upsert,
  remove: remove,
  removeAll: removeAll,
  drop: drop,
  // linq aliases
  from: collection,
  take: limit,
  orderBy: sort,
  first: one, // note, does not throw (unlike linq), equivalent to firstOrDefault
  firstOrDefault: one,
  // operations
  forEach: forEach,
  // convenience
  byId: byId,
  byIds: byIds,
  // static
  ObjectId: ObjectId,
  ObjectID: ObjectId,
  like: like
}

// deferred
// returns a function which executes the query
// *thunk*
function deferOne() {
  var self = this;
  return function () {
    return self.one()
  }
}

function deferToArray() {
  var self = this;
  return function () {
    return self.toArray()
  }
}

// query
//

function clone() {
  var c = new Query()
  c._.db = this._.db
  c._.collection = this._.collection
  c._.query = deepClone(this._.query)
  c._.projection = deepClone(this._.projection)
  c._.options = deepClone(this._.options)
  return c
}

// @param collection: String
function collection(collection) {
  return new Query(this._.db, collection)
}

// @param query: Object
function where(query) {
  this._.query = extend(this._.query, query)
  return this
}

// @param key: String
function not(key) {
  var clause = {}
  clause[key] = {$in: [false, null, undefined]}
  return this.where(clause)
}

// options
//

// (Object|Array<String>) => MinqQuery
function select(projection) {
  // accept arrays of field names to include (dot-notation ok)
  if (Array.isArray(projection)) {
    this._.projection = projection.reduce(function (projection, field) {
      projection[field] = true
      return projection
    }, {})
  } else {
    this._.projection = projection
  }
  return this
}

// @param sort Object
function sort(sort) {
  this._.options.sort = sort
  return this
}

// @param limit Number
function limit(limit) {
  this._.options.limit = limit
  return this
}

// @param skip Number
function skip(skip) {
  this._.options.skip = skip
  return this
}

// @param opts Object
function options(opts) {
  extend(this._.options, opts)
  return this
}

// finalizers
//

// @return Promise<Array>
function toArray() {
  var self = this
  if (self._.err) {
    return Q.reject(self._.err)
  }
  var dfd = Q.defer()

  getCursor(self, function (err, cursor) {
    if (err) { return dfd.reject(err) }
    log(self._.options)
    log('toArray')
    cursor.toArray(function (err, array) {
      if (err) { return dfd.reject(err) }
      var actualCount = array ? array.length : 0
      if (typeof self._.expected === 'number' && self._.expected !== actualCount) {
        return dfd.reject(new Error('Expected ' + self._.expected + ' document' + (self._.expected === 1 ? '' : 's') +', but matched ' + actualCount))
      }
      dfd.resolve(array || [])
    })
  })

  return dfd.promise
}

// @return Promise<Object>
function one() {
  var self = this
  if (self._.err) {
    return Q.reject(self._.err)
  }
  var dfd = Q.defer()

  self._.options.limit = 1

  getCursor(self, function (err, cursor) {
    if (err) { return dfd.reject(err) }
    log(self._.options)
    log('one')
    cursor.nextObject(function (err, doc) {
      if (err) { return dfd.reject(err) }
      var actualCount = doc ? 1 : 0;
      if (typeof self._.expected === 'number' && self._.expected !== actualCount) {
        return dfd.reject(new Error('Expected ' + self._.expected + ' document' + (self._.expected === 1 ? '' : 's') +', but matched ' + actualCount))
      }
      dfd.resolve(doc || null)
    })
  })

  return dfd.promise
}

// @return Stream
function stream() {
  var stream = through(function (data) { this.queue(data) })
  var self = this
  if (self._.err) {
    stream.emit('error', self._.err)
    return stream
  }


  getCursor(self, function (err, cursor) {
    if (err) {
      stream.emit('error', err)
      stream.emit('end')
      return;
    }
    log(self._.options)
    log('streaming...')
    cursor.stream().pipe(stream)
    stream.on('end', function () { log('stream end')})
  })

  return stream
}

// (iterator: (Object) => Promise?) => Promise
// Streams the results of a query. If `iterator`
// returns a promise, will await each of the promises,
// for example if performing batch updates.
// Returns a void Promise to rejoin program execution
// once all results have been iterated.
function forEach(iterator) {
  return this.stream()
    .pipe(charybdis(iterator))
}

// @return Promise<Number>
function count() {
  var self = this
  if (self._.err) {
    return Q.reject(self._.err)
  }
  var dfd = Q.defer()

  getCursor(self, function (err, cursor) {
    if (err) { return dfd.reject(err) }
    log(self._.options)
    log('count')
    cursor.count(function (err, count) {
      if (err) { return dfd.reject(err) }
      dfd.resolve(count)
    })
  })

  return dfd.promise
}

// mutators
//

// @param doc Object|Array<Object>
// @return Promise<Object>|Promise<Array<Object>>
function insert (doc) {
  var self = this
  if (self._.err) {
    return Q.reject(self._.err)
  }
  var dfd = Q.defer()

  getCollection(self, function (err, collection) {
    if (err) { return dfd.reject(err) }
    log(self._.options)
    log('insert', doc)
    collection.insert(doc, self._.options, function (err, result) {
      if (err) { return dfd.reject(err) }
      dfd.resolve(result)
    })
  })

  return dfd.promise
}

// @param changes Object - a mongodb setter/unsetter
// @returns Promise<Document> - the document BEFORE the changes object has been applied
function findAndModify(changes) {
  var self = this
  if (self._.err) {
    return Q.reject(self._.err)
  }
  return Q.promise(function (resolve, reject) {
    self._.options.new = false
    self._.options.upsert = false
    self._.options.sort = self._.options.sort || {_id: 1}

    getCollection(self, function (err, collection) {
      if (err) { return reject(err) }
      log(self._.options)
      log('findAndModify', self._.query, changes)
      collection.findAndModify(self._.query, self._.options.sort, changes, self._.options, function (err, result) {
        if (err) { return reject(err) }
        resolve(result)
      })
    })
  })
}

// @param changes Object - a mongodb setter/unsetter
// @returns Promise<Document> - the document AFTER the changes object has been applied
function modifyAndFind(changes) {
  var self = this
  if (self._.err) {
    return Q.reject(self._.err)
  }
  return Q.promise(function (resolve, reject) {
    self._.options.new = true
    self._.options.upsert = false
    self._.options.sort = self._.options.sort || {_id: 1}

    getCollection(self, function (err, collection) {
      if (err) { return reject(err) }
      log(self._.options)
      log('findAndModify', self._.query, changes)
      collection.findAndModify(self._.query, self._.options.sort, changes, self._.options, function (err, result) {
        if (err) { return reject(err) }
        resolve(result)
      })
    })
  })
}


// @returns Promise<Document> - the matching document which was removed
// from the collection
function pull() {
  var self = this
  if (self._.err) { return Q.reject(self._.err) }
  return Q.promise(function (resolve, reject) {
    self._.options.remove = true
    getCollection(self, function (err, collection) {
      if (err) { return reject(err) }
      log(self._.options)
      log('pull', self._.query)
      collection.findAndModify(self._.query, self._.options.sort, {}, self._.options, function (err, result) {
        if (err) { return reject(err) }
        resolve(result)
      })
    })
  })
}

// @returns Query
function expect(count) {
  this._.expected = count
  return this
}

// @returns Promise. Rejected if the number of results does not match the expected count
function assertExists(expectedCount) {
  var self = this
  return self.checkExists(expectedCount).then(function (exists) {
    if (!exists) {
      throw new Error('Expected ' + expectedCount + ' document' + (expectedCount !== 1 ? 's' : '') +
        ', but found ' + self._.count)
    }
  })
}

// @returns Promise<Boolean> - true iff number of results matches the expected count
function checkExists(expectedCount) {
  expectedCount = expectedCount || 1
  var self = this
  if (self._.err) {
    return Q.reject(self._.err)
  }

  return Q.promise(function (resolve, reject) {
    getCursor(self, function (err, cursor) {
      if (err) { return reject(err) }
      log(self._.options)
      log('checkExists', self._.expected, self._.query)
      cursor.count(function (err, count) {
        if (err) { return reject(err) }
          self._.count = count
        return count === expectedCount
      })
    })
  })
}

// @param changes Object - a mongodb setter/unsetter
// @return Promise<Number> - count of updated documents
function update(changes) {
  var self = this
  if (self._.err) {
    return Q.reject(self._.err)
  }
  var dfd = Q.defer()
  var restoreId = false


  self._.options.upsert = false
  self._.options['new'] = true

  if ('_id' in changes) {
    self._.query._id = restoreId = changes._id
    delete changes._id
  }

  getCollection(self, function (err, collection) {
    if (err) { return dfd.reject(err) }
    log(self._.options)
    log('update', changes)
    collection.update(self._.query, changes, self._.options, function (err, result) {
      if (err) { dfd.reject(err) }
      if (restoreId) { changes._id = restoreId }
      dfd.resolve(result)
    })
  })

  return dfd.promise
}

// @param changes Object - a mongodb setter/unsetter
// @return Promise<Number> - count of updated documents
function upsert(changes) {
  var self = this
  if (self._.err) {
    return Q.reject(self._.err)
  }
  var dfd = Q.defer()
  var restoreId = false

  self._.options.upsert = true

  if ('_id' in changes) {
    self._.query._id = restoreId = changes._id
    if (hasOperators(changes)) {
      delete changes._id
    }
  }

  getCollection(self, function (err, collection) {
    if (err) { return dfd.reject(err) }
    log(self._.options)
    log('where', self._.query)
    log('upsert', changes)
    collection.update(self._.query, changes, self._.options, function (err, result) {
      if (err) { dfd.reject(err) }
      if (restoreId) { changes._id = restoreId }
      dfd.resolve(result)
    })
  })

  return dfd.promise
}

// Removes documents matching the `where` query from a collection
// @return Promise<Number> - count of removed documents
function remove() {
  var self = this
  if (self._.err) {
    return Q.reject(self._.err)
  }
  if (Object.keys(self._.query).length === 0) {
    return Q.reject(new Error('No `where` query specified. Use minq.removeAll to remove all documents.'))
  }
  var dfd = Q.defer()
  log(self._.options)
  log('remove')

  getCollection(self, function (err, collection) {
    collection.remove(self._.query, self._.options, function (err, count) {
      if (err) { return dfd.reject(err) }
      dfd.resolve(count)
    })
  })

  return dfd.promise
}

// Removes all documents from a collection
// @return Promise<Number> - count of removed documents
function removeAll() {
  var self = this
  if (self._.err) {
    return Q.reject(self._.err)
  }
  var dfd = Q.defer()
  log('removeAll')

  getCollection(self, function (err, collection) {
    collection.remove(self._.options, function (err, count) {
      if (err) { return dfd.reject(err) }
      dfd.resolve(count)
    })
  })

  return dfd.promise
}

// Drops an entire collection
// @return Promise
function drop(collection) {
  var self = this
  if (self._.err) {
    return Q.reject(self._.err)
  }
  var dfd = Q.defer()
  log('drop')

  if (collection) {
    self._.collection = collection
  }

  getCollection(self, function (err, collection) {
    collection.drop(function (err, result) {
      if (err) { return dfd.reject(err) }
      dfd.resolve(result)
    })
  })

  return dfd.promise
}

// helpers

function getCollection(self, cb) {
  Q.when(self._.db, function (db) {
    if (!self._.collection) {
      cb(new ArgumentError('Collection must be specified'))
    }
    try {
      db.collection(self._.collection, function (err, collection) {
        if (err) { return cb(err) }
        log('from ', self._.collection)
        return cb(null, collection)
      })
    } catch (e) {
      if (!db) { cb(new Error('db not specified'))}
      cb(e)
    }
  })
}

function getCursor(self, cb) {
  Q.when(self._.db, function (db) {
    try{
      db.collection(self._.collection, function (err, collection) {
        if (err) { return cb(err) }
        var q = [self._.query]
        if (self._.projection) {
          q.push(self._.projection)
        } else {
          q.push({}) // select all
        }
        q.push(self._.options)
        log('from ', self._.collection)
        log('where ', q[0])
        if (self._.projection) { log('select ', q[1]) }
        cb(null, collection.find.apply(collection, q))
      })
    } catch (e) {
      if (!db) { cb(new Error('db not specified'))}
      cb(e)
    }
  })
}

var updateOperators = [
  '$addToSet',
  '$pop',
  '$pull',
  '$pullAll',
  '$push',
  '$pushAll',
  '$rename',
  '$set',
  '$setOnInsert',
  '$unset']

function hasOperators(obj) {
  return updateOperators.some(function (op) {
    return op in obj
  })
}

module.exports = Query

// contextual constructor
// @param collection String
module.exports.from = module.exports.collection = function (collection) {
  return new Query(connection, collection)
}

module.exports.drop = function (collection) {
  return module.exports.collection(collection).drop()
}

// convenience
module.exports.connect = connect

function ObjectId(id) {
  if (this instanceof ObjectId || typeof id === 'string') {
    return new mongodb.ObjectID(id)
  }
  if (typeof id === 'object') {
    return new mongodb.ObjectID(id.toString())
  }
  return new mongodb.ObjectID()
}

function coerceObjectId (id) {
  return utils.isObjectId(id)
    ? ObjectId(id)
    : id
}

function byId(id) {
  if (!id) {
    this._.err = new Error('id must not be blank')
    return this
  }

  this.where({_id: coerceObjectId(id) })
  return this
}

function byIds(ids) {
  if (!Array.isArray(ids)) {
    this._.err = new Error('ids must be an Array')
    return this
  }

  this.where({_id: {$in: ids.map(coerceObjectId)} })
  return this
}

module.exports.ObjectId = ObjectId
module.exports.ObjectID = ObjectId
module.exports.like = like

function like(string) {
  return new RegExp(quotemeta(string), 'i')
}

function log() {
  if (!module.exports.verbose) { return }
  var vals = Array.prototype.slice.call(arguments)
  vals.unshift('minq -')
  console.log.apply(console, vals)
}

// open and set the default db connection
// (global setting for all references to this module)
// @param connectionString  String   a mongodb connection string,
//         see http://docs.mongodb.org/manual/reference/connection-string/
// @param options   Object  MongoClient connection options
// @return Promise<Function>  returns a function which can be invoked to close the mongodb connection
//
// for argument syntax, see http://mongodb.github.com/node-mongodb-native/driver-articles/mongoclient.html
//
// (connectionString: String, options?) => MinqDb
// e.g.:
// minq.connect('cs').then(function (db) {
//  db.myCollection.count()
// })
function connect(connectionString, options) {
  log('connecting to', maskurl(connectionString))

  return connection = Q.nfcall(
    mongodb.MongoClient.connect,
    connectionString,
    options
  ).then(function (mongodb){
    log('connected')
    connection = mongodb;

  return module.exports.getCollections(mongodb)
    .then(function (collectionNames) {
      // expose minq service
      var db = function () {
        return module.exports(mongodb)
      }

      // allow easy access to collections,
      // eg `db.SKUS.byId(foo).then(...)`
      collectionNames.forEach(function (collection) {
        Object.defineProperty(db, collection, {
          enumerable: true,
          get: function () {
            return module.exports(mongodb).from(collection)
          }
        })
      })

      return db
    })
  })
}


function extend(obj, obj2) {
  for (var key in obj2) {
    if (obj2.hasOwnProperty(key)) {
      obj[key] = obj2[key]
    }
  }
  return obj
}

// (connection?) => Array<String>
module.exports.getCollections = function (_connection) {
  return Q.when(_connection || connection).then(function (db) {
    var dfd = Q.defer()

    db.collectionNames(function (err, names) {
      if (err) { return dfd.reject(err) }
      try {
        names = names.map(function (x) { return x.name.replace(/^\w*\./, '') })
        dfd.resolve(names)
      } catch (e) {
        return dfd.reject(e)
      }
    })

    return dfd.promise
  })
}


module.exports.use = function (plugin) {
  plugin(module.exports)
}