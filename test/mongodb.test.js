var chai = require('chai')
chai.should()
var expect = chai.expect
var sinon = require('sinon')
chai.use(require('sinon-chai'))
chai.use(require('chai-interface'))
var StubDb = require('./stubDb')
var Q = require('q')
Q.longStackSupport = true
var stream = require('stream')

describe('MongoDb', function () {
  var MongoDb = require('../mongodb')

  describe('[[constructor]]', function () {

    it('lifts db to a promise', function (done) {
      var db = {}
      var mdb = new MongoDb(db)
      mdb.db.then(function (val) {
        val.should.equal(db)
      })
      .then(done, done)
    })
    it('has instance interface', function () {
      var mdb = new MongoDb()
      mdb.should.have.interface({
        run: Function,
        runAsStream: Function
      })
    })
  })

  describe('#run', function () {
    ['read','count','exists','insert', 'update', 'findAndModify', 'modifyAndFind', 'pull',
    'upsert', 'remove', 'removeAll'].forEach(function (command) {
    it('dispatches to ' + command + 'command', function (done) {
      var q = StubQuery()
      q.command = command
      var mdb = new MongoDb
      mdb['_'+command] = sinon.stub().returns(Q('result'))
      var result = mdb.run(q)
      result.then(function (val) {
        mdb['_'+command].should.have.been.calledOnce
        mdb['_'+command].should.have.been.calledWithExactly(q)
        val.should.equal('result')
      })
      .then(done, done)
    })
    })
    it('is rejected if unknown command', function (done) {
      var q = StubQuery()
      q.command = 'false command'
      var mdb = new MongoDb
      var result = mdb.run(q)
      result.then(function () {
        throw new Error('should not resolve')
      }, function (e) {
        e.should.match(/unknown/i)
      })
      .then(done, done)
    })
  })

  describe('#runAsStream', function () {
    it('returns a Stream', function () {
      var q = StubQuery()
      var mdb = new MongoDb()
      var s = mdb.runAsStream(q)
      s.on('error', function () { /* ignore */})
      s.should.be.instanceof(stream.Stream)
    })
    it('requires command=read', function (done) {
      var q = {command: 'not-read'}
      var mdb = new MongoDb()
      var stream = mdb.runAsStream(q)
      stream.on('error', function (e) {
        e.should.match(/read/)
        done()
      })
    })
    it('errors if the query has an error', function (done) {
      var q = {command: 'read', err: new Error('query error')}
      var mdb = new MongoDb()
      var stream = mdb.runAsStream(q)
      stream.on('error', function (e) {
        e.should.match(/query error/)
        done()
      })
    })
    it('errors if the underlying read has an error', function (done) {
      var q = StubQuery()
      var mdb = new MongoDb()

      mdb._find = sinon.stub().returns(Q.reject(new Error('read error')))

      var s = mdb.runAsStream(q)
      s.on('error', function (e) {
        e.should.match(/read error/)
        done()
      })

    })
    it('processes read queries', function (done) {

      var q = StubQuery()
      var mdb = new MongoDb()
      var underlyingStream = {
        pipe: sinon.spy()
      }
      var cursor = {
        toStream: sinon.stub().returns(underlyingStream)
      }
      mdb._find = sinon.stub().returns(Q(cursor))

      var s = mdb.runAsStream(q)
      s.on('end', function () {
        try {
          mdb._find.should.have.been.calledOnce
          cursor.toStream.should.have.been.calledOnce
          underlyingStream.pipe.should.have.been.calledOnce
          done()
        } catch (e) {
          done(e)
        }
      })
      s.on('error', done)

    })
  })

  describe('#_find', function () {
    it('calls find', function (done) {

      var find = function (query, callback) {
        find.query = query
        process.nextTick(function () {
          callback(null, [])
        })
      }
      var collection = sinon.stub().returns(Q({find:find}))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.query = {a: 1}
      var mdb = new MongoDb()
      mdb._collection = collection

      mdb._find(q).then(function () {
        collection.should.have.been.calledWithExactly(q)
        find.query.should.equal(q.query)
      })
      .then(done, done)

    })
  })

  describe('#_read', function () {
    it('returns resultset', function (done) {
      var q = StubQuery()
      q.one = true
      var mdb = new MongoDb()
      var cursor = {
        toArray: function (callback) {
          process.nextTick(function () {
            callback(null, ['result','set'])
          })
        }
      }
      mdb._find = sinon.stub().returns(Q(cursor))

      mdb._read(q).then(function (results) {
        results.should.deep.equal(['result', 'set'])
      })
      .then(done, done)
    })
    it('checks for expected scalar return value', function (done) {
      var q = StubQuery()
      q.first = true
      var mdb = new MongoDb()
      var cursor = {
        toArray: function (callback) {
          process.nextTick(function () {
            callback(null, ['result'])
          })
        }
      }
      mdb._find = sinon.stub().returns(Q(cursor))
      mdb._read(q).then(function (results) {
        Array.isArray(results).should.equal(false)
        results.should.equal('result')
      })
      .then(done, done)
    })
  })

  describe('#_collection', function () {
    it('gets underlying collection', function (done) {
      var db = {}

      db.collection = sinon.stub().returns({})

      var q = StubQuery()
      q.collection = 'fooCollection'
      var mdb = new MongoDb(db)

      mdb._collection(q).then(function () {
        db.collection.should.have.been.calledWithExactly('fooCollection')
      })
      .then(done, done)
    })
  })

  describe('#_count', function () {
    it('calls underlying count', function (done) {

      var count = sinon.stub().returns(Q(108))
      var collection = sinon.stub().returns(Q({count:count}))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.query = {a: 1}
      var mdb = new MongoDb()
      mdb._collection = collection

      mdb._count(q).then(function (val) {
        val.should.equal(108)
        collection.should.have.been.calledWithExactly(q)
        count.should.have.been.calledWithExactly(q.query)
      })
      .then(done, done)

    })
  })
  describe('#_exists', function () {
    it('returns true if not 0', function (done) {

      var count = sinon.stub().returns(Q(1))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.query = {a: 1}
      var mdb = new MongoDb()
      mdb._count = count

      mdb._exists(q).then(function (val) {
        val.should.equal(true)
        count.should.have.been.calledWithExactly(q.query)

      })
      .then(done, done)

    })
    it('returns false if 0', function (done) {

      var count = sinon.stub().returns(Q(0))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.query = {a: 1}
      var mdb = new MongoDb()
      mdb._count = count

      mdb._exists(q).then(function (val) {
        val.should.equal(false)
        count.should.have.been.calledWithExactly(q.query)

      })
      .then(done, done)

    })
  })
  describe('#_insert', function () {
    it('calls underlying insert', function (done) {

      var insert = function (val, options, callback) {
        insert.args = arguments
        process.nextTick(function () {
          callback(null, [])
        })
      }
      var collection = sinon.stub().returns(Q({insert:insert}))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.command = 'insert'
      q.commandArg = {foo: 'doc'}
      q.options = {}
      var mdb = new MongoDb()
      mdb._collection = collection

      mdb._insert(q).then(function (val) {

        collection.should.have.been.calledWithExactly(q)
        insert.args[0].should.equal(q.commandArg)
        insert.args[1].should.equal(q.options)
      })
      .then(done, done)

    })
  })
  describe('#_update', function () {
    it('calls underlying update', function (done) {

      var update = function (query, val, options, callback) {
        update.args = arguments
        process.nextTick(function () {
          callback(null, [])
        })
      }
      var collection = sinon.stub().returns(Q({update:update}))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.query = {}
      q.command = 'update'
      q.commandArg = {foo: 'doc'}
      q.options = {}
      var mdb = new MongoDb()
      mdb._collection = collection

      mdb._update(q).then(function (val) {

        collection.should.have.been.calledWithExactly(q)
        update.args[0].should.equal(q.query)
        update.args[1].should.equal(q.commandArg)
        update.args[2].should.equal(q.options)
      })
      .then(done, done)

    })
    it('converts included ._id property to where clause', function (done) {

      var update = function (query, val, options, callback) {
        update.args = arguments
        update.args[0] = JSON.parse(JSON.stringify(update.args[0]))
        update.args[1] = JSON.parse(JSON.stringify(update.args[1]))
        process.nextTick(function () {
          callback(null, [])
        })
      }
      var collection = sinon.stub().returns(Q({update:update}))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.command = 'update'
      q.query = {}
      q.commandArg = {_id: 23, foo: 'doc'}
      var mdb = new MongoDb()
      mdb._collection = collection

      mdb._update(q).then(function (val) {

        collection.should.have.been.calledWithExactly(q)
        update.args[0]._id.should.equal(23)
        update.args[1].should.not.have.property('_id')
        //(update.args[0].isPrototypeOf(q.commandArg)).should.be.true

      })
      .then(done, done)

    })
  })
  describe('#_findAndModify', function () {
    it('calls underlying findAndModify', function (done) {

      var findAndModify = function (query, sort, changes, options, callback) {
        findAndModify.args = arguments
        process.nextTick(function () {
          callback(null, [])
        })
      }
      var collection = sinon.stub().returns(Q({findAndModify:findAndModify}))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.query = {foo: 'bar'}
      q.command = 'findAndModify'
      q.commandArg = {$set: {foo: 'baz'}}
      q.options = {
        sort: {}
      }
      var mdb = new MongoDb()
      mdb._collection = collection

      mdb._findAndModify(q).then(function (val) {

        collection.should.have.been.calledWithExactly(q)
        findAndModify.args.should.not.equal(null)
        findAndModify.args[0].should.equal(q.query)
        findAndModify.args[1].should.equal(q.options.sort)
        findAndModify.args[2].should.equal(q.commandArg)
        findAndModify.args[3].should.equal(q.options)
        var options = findAndModify.args[3]
        options.new.should.equal(false)
        options.upsert.should.equal(false)
      })
      .then(done, done)

    })
    it('specifies a default sort order', function (done) {

      var findAndModify = function (query, sort, changes, options, callback) {
        findAndModify.args = arguments
        process.nextTick(function () {
          callback(null, [])
        })
      }
      var collection = sinon.stub().returns(Q({findAndModify:findAndModify}))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.query = {foo: 'bar'}
      q.command = 'findAndModify'
      q.commandArg = {$set: {foo: 'baz'}}
      q.options = {}
      var mdb = new MongoDb()
      mdb._collection = collection

      mdb._findAndModify(q).then(function (val) {
        findAndModify.args[1].should.deep.equal({_id: 1}) // sort
      })
      .then(done, done)

    })
  })
  describe('#_modifyAndFind', function () {
    it('calls underlying findAndModify', function (done) {

      var findAndModify = function (query, sort, changes, options, callback) {
        findAndModify.args = arguments
        process.nextTick(function () {
          callback(null, [])
        })
      }
      var collection = sinon.stub().returns(Q({findAndModify:findAndModify}))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.query = {foo: 'bar'}
      q.command = 'modifyAndFind'
      q.commandArg = {$set: {foo: 'baz'}}
      q.options = {
        sort: {}
      }
      var mdb = new MongoDb()
      mdb._collection = collection

      mdb._modifyAndFind(q).then(function (val) {

        collection.should.have.been.calledWithExactly(q)
        findAndModify.args.should.not.equal(null)
        findAndModify.args[0].should.equal(q.query)
        findAndModify.args[1].should.equal(q.options.sort)
        findAndModify.args[2].should.equal(q.commandArg)
        findAndModify.args[3].should.equal(q.options)
        var options = findAndModify.args[3]
        // the secret sauce! :
        options.new.should.equal(true)
        options.upsert.should.equal(false)
      })
      .then(done, done)

    })
  })
  describe('#_pull', function () {
    it('calls underlying findAndRemove', function (done) {

      var findAndRemove = function (query, sort, options, callback) {
        findAndRemove.args = arguments
        process.nextTick(function () {
          callback(null, [])
        })
      }
      var collection = sinon.stub().returns(Q({findAndRemove:findAndRemove}))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.query = {foo: 'bar'}
      q.command = 'pull'
      q.commandArg = {$set: {foo: 'baz'}}
      q.options = {
        sort: {}
      }
      var mdb = new MongoDb()
      mdb._collection = collection

      mdb._pull(q).then(function (val) {

        collection.should.have.been.calledWithExactly(q)
        findAndRemove.args.should.not.equal(null)
        findAndRemove.args[0].should.equal(q.query)
        findAndRemove.args[1].should.equal(q.options.sort)
        findAndRemove.args[2].should.equal(q.options)

      })
      .then(done, done)

    })
  })
  describe('#_upsert', function () {
    it('calls underlying update', function (done) {

      var update = function (query, val, options, callback) {
        update.args = arguments
        process.nextTick(function () {
          callback(null, [])
        })
      }
      var collection = sinon.stub().returns(Q({update:update}))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.command = 'upsert'
      q.commandArg = {foo: 'baz'}
      q.options = { }
      var mdb = new MongoDb()
      mdb._collection = collection

      mdb._upsert(q).then(function (val) {

        collection.should.have.been.calledWithExactly(q)
        update.args.should.not.equal(null)
        // default query
        update.args[0].should.deep.equal({})
        update.args[1].should.equal(q.commandArg)
        update.args[2].should.equal(q.options)
        var options = update.args[2]
        options.upsert.should.equal(true)

      })
      .then(done, done)

    })
  })
  describe('#_remove', function () {
    it('calls underlying remove', function (done) {

      var remove = function (query, options, callback) {
        remove.args = arguments
        process.nextTick(function () {
          callback(null, [])
        })
      }
      var collection = sinon.stub().returns(Q({remove:remove}))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.query = {a: 'foo'}
      q.command = 'upsert'
      q.commandArg = {foo: 'baz'}
      q.options = { }
      var mdb = new MongoDb()
      mdb._collection = collection

      mdb._remove(q).then(function (val) {

        collection.should.have.been.calledWithExactly(q)
        remove.args[0].should.equal(q.query)
        remove.args[1].should.equal(q.options)
      })
      .then(done, done)
    })
    it('is rejected if no query specified', function (done) {

      var remove = function (query, options, callback) {
        remove.args = arguments
        process.nextTick(function () {
          callback(null, [])
        })
      }
      var collection = sinon.stub().returns(Q({remove:remove}))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.query = {}
      q.command = 'remove'
      q.commandArg = {foo: 'baz'}
      q.options = { }
      var mdb = new MongoDb()
      mdb._collection = collection

      mdb._remove(q).then(function () {
        throw new Error('should not be fulfilled')
      }, function (err) {
        err.should.match(/query/)
      })
      .then(done, done)
    })
  })
  describe('#_removeAll', function () {
    it('calls underlying remove', function (done) {

      var remove = function (options, callback) {
        remove.args = arguments
        process.nextTick(function () {
          callback(null, [])
        })
      }
      var collection = sinon.stub().returns(Q({remove:remove}))

      var q = StubQuery()
      q.collection = 'fooCollection'
      q.command = 'removeAll'
      q.commandArg = {foo: 'baz'}
      q.options = { }
      var mdb = new MongoDb()
      mdb._collection = collection

      mdb._removeAll(q).then(function (val) {
        collection.should.have.been.calledWithExactly(q)
        remove.args[0].should.equal(q.options)
      })
      .then(done, done)
    })
  })


})
function StubQuery() {
  return {
      command: "read"
  }
}