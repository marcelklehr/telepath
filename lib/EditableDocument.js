var Document = require('./Document')
  , Edit = require('./Edit')

function EditableDocument() {
  Document.apply(this, arguments)
}

module.exports = EditableDocument

EditableDocument.prototype = Object.create(Document.prototype, { constructor: { value: EditableDocument }})

// overrides Document#attachSlaveLink
EditableDocument.prototype.attachSlaveLink = function() {
  // EditableDocuments can only have a master link! Nothing else, because we
  // need to take care of our own edits here, which are live!
  // -- we don't want to mess with other docs' edits!
  throw new Error('You can\'t attach a slave to an editable document!')
}

// overrides Document#receiveInit
EditableDocument.prototype.receiveInit = function(data, fromLink) {
  Document.prototype.receiveInit.call(this, data, fromLink)
  this._change(data.content)
}

/**
 * Update is called when a modification has been made
 *
 * @param cs A changeset that can be swallowed by the ottype
 */
EditableDocument.prototype.update = function(cs) {
  if(null === this.content) throw new Error('Document has not been initialized')

  var edit = Edit.newFromChangeset(cs, this.ottype)
  edit.parent = this.history.latest().id

  this.master.sendEdit(edit, function onack(err, id) { // XXX: We could also merge into the queue
    edit.id = id
    // Update queue
    this.master.queue.forEach(function(edit) {
      edit.parent = id
    })
    this.applyEdit(edit, true)
    //this.distributeEdit(edit) // Unnecessary round trip
    this.history.pushEdit(edit)
  }.bind(this))
}

// overrides Document#sanitizeEdit
EditableDocument.prototype.sanitizeEdit = function(incoming, fromLink) {
  // Collect undetected local changes, before applying the new edit
  this._collectChanges()

  // Transform against possibly missed edits that have happened in the meantime,
  // so that we can apply it

  var incomingOriginal

  if(this.master.sentEdit) {
    incomingOriginal = incoming.clone()
    incoming.transformAgainst(this.master.sentEdit)
    this.master.sentEdit.follow(incomingOriginal) // Why!?
  }

  incomingOriginal = incoming.clone()

  // transform incoming against pending
  this.master.queue.forEach(function(pendingEdit) {
    incoming.transfromAgainst(pendingEdit)
  })

  // Transform pending edits against the incoming one
  this.master.queue.forEach(function(pendingEdit, i) {
    if(i === 0) {
      pendingEdit.follow(incomingOriginal) // transform + adjust parentage for the first in the line
    }
    else {
      pendingEdit.transformAgainst(incomingOriginal) // all others have their predecessors as parents
    }

    incomingOriginal.transformAgainst(pendingEdit)
  })

  // add edit to history
  this.history.pushEdit(incoming)

  return incoming
}

// overrides Document#applyEdit
EditableDocument.prototype.applyEdit = function(edit, ownEdit) {
  // apply changes
  console.log('EditableDocument: apply edit', edit)
  try {
    this.content = edit.apply(this.content)
    if(!ownEdit) this._change(this.content, edit.changeset)
  }catch(e) {
    throw new Error('Applying edit "'+edit.id+'" failed: '+e.message)
  }
}