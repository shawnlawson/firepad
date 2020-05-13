var firepad = firepad || {};

var AtomAdapter = function() {

  function AtomAdapter(atomInstance) {
    this.atom = atomInstance
    this.editor = this.atom.workspace.getActiveTextEditor()
    this.addedStyleRules = [];
    this.markerLayer = this.editor.addMarkerLayer()
    this.ignoreChanges = false

    this.onBlur = this.onBlur.bind(this);
    this.onFocus = this.onFocus.bind(this);

    this.CCP = this.editor.onDidChangeCursorPosition((event) => {this.onCursorActivity()})
    this.DC = this.editor.buffer.onDidChange((event) => {this.onChange(event)})
    this.atom.getCurrentWindow().on('blur', this.onBlur)
    this.atom.getCurrentWindow().on('focus', this.onFocus)
  }

  AtomAdapter.prototype.detach = function() {
    this.CCP.dispose()
    this.DC.dispose()
    this.atom.getCurrentWindow().off('focus', this.onFocus);
    this.atom.getCurrentWindow().off('blur', this.onBlur);
  }

  AtomAdapter.prototype.operationFromAtomChange = function (changes) {
    var docEndLength = this.editor.buffer.getMaxCharacterIndex()
    var operation    = new firepad.TextOperation().retain(docEndLength)
    var inverse      = new firepad.TextOperation().retain(docEndLength)

    for(var i = changes.length -1; i >= 0; i--) {
      var change = changes[i]
      var fromIndex = this.editor.buffer.characterIndexForPosition(change.oldRange.start)
      var restLength = docEndLength - fromIndex - change.newText.length;

      operation = new firepad.TextOperation()
          .retain(fromIndex)
          ['delete'](change.oldText.length)
          .insert(change.newText)
          .retain(restLength)
          .compose(operation);

      inverse = inverse.compose(new firepad.TextOperation()
          .retain(fromIndex)
          ['delete'](change.newText.length)
          .insert(change.oldText)
          .retain(restLength)
      );

      docEndLength += change.oldText.length - change.newText.length;
    }

    return [operation, inverse]
  }

  AtomAdapter.prototype.registerCallbacks = function (cb) {
    this.callbacks = cb
  }

  AtomAdapter.prototype.onChange = function (event) {
    if (!this.ignoreChanges) {
      var pair = this.operationFromAtomChange(event.changes)
      this.trigger('change', pair[0], pair[1])
    }
  }

  AtomAdapter.prototype.onCursorActivity = function () {
    var self = this
    setTimeout( function() {
      self.trigger('cursorActivity') },
      1)
  }

  AtomAdapter.prototype.onFocus = function () {
    this.trigger('focus')
  }

  AtomAdapter.prototype.onBlur = function () {
    if(this.editor.getSelectedBufferRange().isEmpty()){
      this.trigger('blur')
    }
  }

  AtomAdapter.prototype.getValue = function() {
    this.editor.getText()
  }

  AtomAdapter.prototype.getCursor = function() {
    if (this.editor.getSelectedBufferRange().isEmpty()) {
      var cursor = this.editor.getCursorBufferPosition()
      var index = this.editor.buffer.characterIndexForPosition(cursor)
      return new firepad.Cursor(index, index)
    }
    var range = this.editor.getSelectedBufferRange()
    var start = this.editor.buffer.characterIndexForPosition(range.start)
    var end = this.editor.buffer.characterIndexForPosition(range.end)
    if (start < end) {
      return new firepad.Cursor(start, end)
    } else { // reversed
      return new firepad.Cursor(end, start)
    }
  }

  AtomAdapter.prototype.setCursor = function (cursor) {
    var start = this.editor.buffer.positionForCharacterIndex(cursor.position)
    var end = this.editor.buffer.positionForCharacterIndex(cursor.selectionEnd)
    if (cursor.position == cursor.selectionEnd) {
      this.editor.setCursorBufferPosition(start)
    } else if (cursor.position > cursor.selectionEnd) {
      this.editor.setSelectedBufferRange([[start.row, start.column], [end.row, end.column]])
    } else {
      this.editor.setSelectedBufferRange([[end.row, end.column], [start.row, start.column]])
    }
  }

  AtomAdapter.prototype.setOtherCursor = function (cursor, color, clientId) {
    if (typeof color !== 'string' || !color.match(/^#[a-fA-F0-9]{3,6}$/)) {
      return
    }
    var end = this.editor.buffer.getMaxCharacterIndex()
    if (typeof cursor !== 'object' || typeof cursor.position !== 'number' || typeof cursor.selectionEnd !== 'number') {
      return
    }
    if (cursor.position < 0 || cursor.position > end || cursor.selectionEnd < 0 || cursor.selectionEnd > end) {
      return
    }

    var reversed = false
    if (cursor.position > cursor.selectionEnd) {reversed = true}
    var start = this.editor.buffer.positionForCharacterIndex(cursor.position)
    var stop = this.editor.buffer.positionForCharacterIndex(cursor.selectionEnd)

//two people only right now
    this.markerLayer.clear()
    // this.markerLayer = this.editor.addMarkerLayer()

    var selection  = null
    if (start !== stop) { //add selection
      selection = this.markerLayer.markBufferRange(
          [[start.row, start.column], [stop.row, stop.column]], {invalidate: 'never', reversed: reversed}
      )
    }

    this.editor.decorateMarkerLayer(this.markerLayer, {type: 'highlight', class: 'selection'})

    var location = this.markerLayer.markBufferPosition(
      [start.row, start.column],
      {invalidate: 'never'}
    )

    var clazz = "other-client-cursor-" + color.replace('#', '');

    var css = this.getCSS(clazz, color, color);
    this.addStyleRule(clazz, css);

    this.editor.decorateMarker(location,
      {type: 'cursor',
      class: clazz})
  }

  AtomAdapter.prototype.getCSS = function (clazz, bgColor, color) {
    return "." + clazz + " { "+
      // \n  position: relative;\n" +
      // "background-color: " + bgColor + ";\n" +
      "border-left: 2px solid " + color + "!important;\n}"
  }

  AtomAdapter.prototype.addStyleRule = function (clazz, css) {
    /** House Keeping */
    if (typeof document === 'undefined' || document === null) {
      return false;
    }

    /** Add style rules only once */
    if (this.addedStyleRules.indexOf(clazz) === -1) {
      var styleElement = document.createElement('style');
      var styleSheet = document.createTextNode(css);
      styleElement.appendChild(styleSheet);
      document.head.appendChild(styleElement);
      this.addedStyleRules.push(clazz);
    }
  };

  AtomAdapter.prototype.trigger = function (event) {
    var args = Array.prototype.slice.call(arguments, 1)
    var action = this.callbacks && this.callbacks[event]
    if (action) {action.apply(this, args)}
  }

  AtomAdapter.prototype.applyOperation = function (operation) {
    if (!operation.isNoop()) {this.ignoreChanges = true}

    var opsList = operation.ops
    var index = 0
    for (const op of opsList) {
      if (op.isRetain()){
        index += op.chars
      } else if (op.isInsert()) {
        this.editor.buffer.insert(
          this.editor.buffer.positionForCharacterIndex(index),
          op.text
        )
        index += op.text.length
      } else if (op.isDelete()) {
        var from = this.editor.buffer.positionForCharacterIndex(index)
        var to = this.editor.buffer.positionForCharacterIndex(index + op.chars)
        this.editor.buffer.delete(
          [[from.row, from.column], [to.row, to.column]])
      }
    }

    this.ignoreChanges = false
  }

  AtomAdapter.prototype.registerUndo = function (undoFn) {
    this.editor.undo = undoFn
  }

  AtomAdapter.prototype.registerRedo = function (redoFn) {
    this.editor.redo = redoFn
  }

  AtomAdapter.prototype.invertOperation = function (operation) {
    var pos = 0
    var inverse = new firepad.TextOperation()

    for (const op of operation.wrapped.ops) {
      if (op.isRetain()) {
        inverse.retain(op.chars)
        pos += op.chars;
      } else if (op.isInsert()) {
        inverse['delete'](op.text.length);
      } else if (op.isDelete()) {
        var from = this.editor.buffer.positionForCharacterIndex(pos)
        var to = this.editor.buffer.positionForCharacterIndex(pos + op.chars)
        var text = this.editor.buffer.getTextInRange(
          [[from.row, from.column], [to.row, to.column]]
        )
        inverse.insert(text)
        pos += op.chars;
      }
    }

    return new firepad.WrappedOperation(inverse, operation.meta.invert());
  }

  return AtomAdapter;
}();

firepad.AtomAdapter = AtomAdapter;
