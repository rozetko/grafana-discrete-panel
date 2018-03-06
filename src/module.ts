///<reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />

import config from 'app/core/config';

import {CanvasPanelCtrl} from './canvas-metric';
import {DistinctPoints} from './distinct-points';


import _ from 'lodash';
import $ from 'jquery';
import moment from 'moment';
import kbn from 'app/core/utils/kbn';

import appEvents from 'app/core/app_events';

const grafanaColors = [
  "#7EB26D", "#EAB839", "#6ED0E0", "#EF843C", "#E24D42", "#1F78C1", "#BA43A9", "#705DA0",
  "#508642", "#CCA300", "#447EBC", "#C15C17", "#890F02", "#0A437C", "#6D1F62", "#584477",
  "#B7DBAB", "#F4D598", "#70DBED", "#F9BA8F", "#F29191", "#82B5D8", "#E5A8E2", "#AEA2E0",
  "#629E51", "#E5AC0E", "#64B0C8", "#E0752D", "#BF1B00", "#0A50A1", "#962D82", "#614D93",
  "#9AC48A", "#F2C96D", "#65C5DB", "#F9934E", "#EA6460", "#5195CE", "#D683CE", "#806EB7",
  "#3F6833", "#967302", "#2F575E", "#99440A", "#58140C", "#052B51", "#511749", "#3F2B5B",
  "#E0F9D7", "#FCEACA", "#CFFAFF", "#F9E2D2", "#FCE2DE", "#BADFF4", "#F9D9F9", "#DEDAF7"
]; // copied from public/app/core/utils/colors.ts because of changes in grafana 4.6.0
//(https://github.com/grafana/grafana/blob/master/PLUGIN_DEV.md)



class DiscretePanelCtrl extends CanvasPanelCtrl {
  static templateUrl = 'partials/module.html';

  defaults = {
    display: 'timeline',
    rowHeight: 50,
    valueMaps: [
      { value: 'null', op: '=', text: 'N/A' }
    ],
    mappingTypes: [
      {name: 'value to text', value: 1},
      {name: 'range to text', value: 2},
    ],
    rangeMaps: [
      { from: 'null', to: 'null', text: 'N/A' }
    ],
    colorMaps: [
      { text: 'N/A', color: '#CCC' }
    ],
    metricNameColor: '#000000',
    valueTextColor: '#000000',
    backgroundColor: 'rgba(128, 128, 128, 0.1)',
    lineColor: 'rgba(128, 128, 128, 1.0)',
    textSize: 24,
    extendLastValue: true,
    writeLastValue: true,
    writeAllValues: false,
    writeMetricNames: false,
    showLegend: true,
    showLegendNames: true,
    showLegendValues: true,
    showLegendPercent: true,
    highlightOnMouseover: true,
    legendSortBy: '-ms',
    units: 'short'
  };

  data: any = null;
  externalPT = false;
  isTimeline = false;
  isStacked = false;
  hoverPoint: any = null;
  colorMap: any = {};
  _colorsPaleteCash: any = null;
  unitFormats: any = null; // only used for editor
  formatter: any = null;

  _renderDimensions: any = {};
  _selectionMatrix: Array<Array<String>> = [];

  constructor($scope, $injector) {
    super($scope, $injector);

    // defaults configs
    _.defaultsDeep(this.panel, this.defaults);


    this.events.on('init-edit-mode', this.onInitEditMode.bind(this));
    this.events.on('render', this.onRender.bind(this));
    this.events.on('data-received', this.onDataReceived.bind(this));
    this.events.on('data-error', this.onDataError.bind(this));
    this.events.on('refresh', this.onRefresh.bind(this));

    this.updateColorInfo();
    this.onConfigChanged();
  }

  onDataError(err) {
    console.log("onDataError", err);
  }

  onInitEditMode() {
    this.unitFormats = kbn.getUnitFormats();

    this.addEditorTab('Options', 'public/plugins/natel-discrete-panel/partials/editor.options.html',1);
    this.addEditorTab('Legend', 'public/plugins/natel-discrete-panel/partials/editor.legend.html',3);
    this.addEditorTab('Colors', 'public/plugins/natel-discrete-panel/partials/editor.colors.html',4);
    this.addEditorTab('Mappings', 'public/plugins/natel-discrete-panel/partials/editor.mappings.html', 5);
    this.editorTabIndex = 1;
    this.refresh();
  }

  onRender() {
    if (this.data == null ||  !(this.context) ) {
      return;
    }

    this._updateRenderDimensions();
    this._updateSelectionMatrix();
    this._updateCanvasSize();
    this._renderRects();
    this._renderLabels();
    this._renderSelection();
    this._renderCrosshair();
  }

  showLegandTooltip(pos, info) {
    var body = '<div class="graph-tooltip-time">'+ info.val +'</div>';

    body += "<center>";
    if (info.count > 1) {
      body += info.count + " times<br/>for<br/>";
    }
    body += moment.duration(info.ms).humanize();
    if (info.count > 1) {
      body += "<br/>total";
    }
    body += "</center>";

    this.$tooltip.html(body).place_tt(pos.pageX + 20, pos.pageY);
  }

  clearTT() {
    this.$tooltip.detach();
  }

  formatValue(val) {

    if (_.isNumber(val) ) {
      if( this.panel.rangeMaps ) {
        for (let i = 0; i < this.panel.rangeMaps.length; i++) {
          var map = this.panel.rangeMaps[i];

          // value/number to range mapping
          var from = parseFloat(map.from);
          var to = parseFloat(map.to);
          if (to >= val && from <= val) {
            return map.text;
          }
        }
      }
      if( this.formatter ) {
        return this.formatter( val, this.panel.decimals );
      }
    }

    var isNull = _.isNil(val);
    if (!isNull && !_.isString(val)) {
      val = val.toString(); // convert everything to a string
    }

    for (let i = 0; i < this.panel.valueMaps.length; i++) {
      let map = this.panel.valueMaps[i];
      // special null case
      if (map.value === 'null') {
        if (isNull) {
          return map.text;
        }
        continue;
      }

      if (val === map.value) {
        return map.text;
      }
    }

    if (isNull) {
      return "null";
    }
    return val;
  }

  getColor(val) {
    if (_.has(this.colorMap, val)) {
      return this.colorMap[val];
    }
    if (this._colorsPaleteCash[val] === undefined) {
      var c = grafanaColors[this._colorsPaleteCash.length % grafanaColors.length];
      this._colorsPaleteCash[val] = c;
      this._colorsPaleteCash.length++;
    }
    return this._colorsPaleteCash[val];
  }

  randomColor() {
    var letters = 'ABCDE'.split('');
    var color = '#';
    for (var i = 0; i < 3; i++) {
      color += letters[Math.floor(Math.random() * letters.length)];
    }
    return color;
  }

  // Override the 
  applyPanelTimeOverrides() {
    super.applyPanelTimeOverrides();

    if (this.panel.expandFromQueryS > 0) {
      let from = this.range.from.subtract( this.panel.expandFromQueryS, 's' );
      this.range.from = from;
      this.range.raw.from = from;
    }
  }


  onDataReceived(dataList) {
    $(this.canvas).css( 'cursor', 'pointer' );

//    console.log('GOT', dataList);

    var data = [];
    _.forEach(dataList, (metric) => {
      if ('table'=== metric.type) {
        if ('time' !== metric.columns[0].type) {
          throw new Error('Expected a time column from the table format');
        }

        var last = null;
        for (var i = 1; i<metric.columns.length; i++) {
          let res = new DistinctPoints(metric.columns[i].text);
          for (var j = 0; j<metric.rows.length; j++) {
            var row = metric.rows[j];
            res.add( row[0], this.formatValue( row[i] ) );
          }
          res.finish( this );
          data.push( res );
        }
      } else {
        let res = new DistinctPoints( metric.target );
        _.forEach(metric.datapoints, (point) => {
          res.add( point[1], this.formatValue(point[0]) );
        });
        res.finish( this );
        data.push( res );
      }
    });
    this.data = data;

    this.onRender();

    //console.log( 'data', dataList, this.data);
  }

  removeColorMap(map) {
    var index = _.indexOf(this.panel.colorMaps, map);
    this.panel.colorMaps.splice(index, 1);
    this.updateColorInfo();
  }

  updateColorInfo() {
    var cm = {};
    for (var i = 0; i<this.panel.colorMaps.length; i++) {
      var m = this.panel.colorMaps[i];
      if (m.text) {
        cm[m.text] = m.color;
      }
    }
    this._colorsPaleteCash = {};
    this._colorsPaleteCash.length = 0;
    this.colorMap = cm;
    this.render();
  }

  addColorMap(what) {
    if (what === 'curent') {
      _.forEach(this.data, (metric) => {
        if (metric.legendInfo) {
          _.forEach(metric.legendInfo, (info) => {
            if (!_.has(info.val)) {
              this.panel.colorMaps.push({text: info.val, color: this.getColor(info.val) });
            }
          });
        }
      });
    } else {
      this.panel.colorMaps.push({text: '???', color: this.randomColor() });
    }
    this.updateColorInfo();
  }

  removeValueMap(map) {
    var index = _.indexOf(this.panel.valueMaps, map);
    this.panel.valueMaps.splice(index, 1);
    this.render();
  }

  addValueMap() {
    this.panel.valueMaps.push({value: '', op: '=', text: '' });
  }

  removeRangeMap(rangeMap) {
    var index = _.indexOf(this.panel.rangeMaps, rangeMap);
    this.panel.rangeMaps.splice(index, 1);
    this.render();
  }

  addRangeMap() {
    this.panel.rangeMaps.push({from: '', to: '', text: ''});
  }

  onConfigChanged( update = false ) {
    //console.log( "Config changed...");
    this.isTimeline = this.panel.display == 'timeline';
    this.isStacked = this.panel.display == 'stacked';

    this.formatter = null;
    if(this.panel.units && 'none' != this.panel.units ) {
      this.formatter = kbn.valueFormats[this.panel.units]
    }

    if(update) {
      this.refresh();
    }
    else {
      this.render();
    }
  }

  getLegendDisplay(info, metric) {
    var disp = info.val;
    if (this.panel.showLegendPercent || this.panel.showLegendCounts || this.panel.showLegendTime) {
      disp += " (";
      var hassomething = false;
      if (this.panel.showLegendTime) {
        disp += moment.duration(info.ms).humanize();
        hassomething = true;
      }

      if (this.panel.showLegendPercent) {
        if (hassomething) {
          disp += ", ";
        }

        var dec = this.panel.legendPercentDecimals;
        if (_.isNil(dec)) {
          if (info.per>.98 && metric.changes.length>1) {
            dec = 2;
          } else if (info.per<0.02) {
            dec = 2;
          } else {
            dec = 0;
          }
        }
        disp += kbn.valueFormats.percentunit(info.per, dec);
        hassomething = true;
      }

      if (this.panel.showLegendCounts) {
        if (hassomething) {
          disp += ", ";
        }
        disp += info.count+"x";
      }
      disp += ")";
    }
    return disp;
  }

  //------------------
  // Mouse Events
  //------------------

  showTooltip(evt, point, isExternal) {
    var from = point.start;
    var to = point.start + point.ms;
    var time = point.ms;
    var val = point.val;

    if (this.mouse.down != null) {
      from = Math.min(this.mouse.down.ts, this.mouse.position.ts);
      to   = Math.max(this.mouse.down.ts, this.mouse.position.ts);
      time = to - from;
      val = "Zoom To:";
    }

    var body = '<div class="graph-tooltip-time">'+ val + '</div>';

    body += "<center>";
    body += this.dashboard.formatDate( moment(from) ) + "<br/>";
    body += "to<br/>";
    body += this.dashboard.formatDate( moment(to) ) + "<br/><br/>";
    body += moment.duration(time).humanize() + "<br/>";
    body += "</center>";

    var pageX = 0;
    var pageY = 0;
    if (isExternal) {
      var rect = this.canvas.getBoundingClientRect();
      pageY = rect.top + (evt.pos.panelRelY * rect.height);
      if (pageY < 0 || pageY > $(window).innerHeight()) {
        // Skip Hidden tooltip
        this.$tooltip.detach();
        return;
      }
      pageY += $(window).scrollTop();

      var elapsed = this.range.to - this.range.from;
      var pX = (evt.pos.x - this.range.from) / elapsed;
      pageX = rect.left + (pX * rect.width);
    } else {
      pageX = evt.evt.pageX;
      pageY = evt.evt.pageY;
    }

    this.$tooltip.html(body).place_tt(pageX + 20, pageY + 5);
  }

  onGraphHover(evt, showTT, isExternal) {
    this.externalPT = false;
    if (this.data && this.data.length) {
      var hover = null;
      var j = Math.floor(this.mouse.position.y/this.panel.rowHeight);
      if (j < 0) {
        j = 0;
      }
      if (j >= this.data.length) {
        j = this.data.length-1;
      }

      if (this.isTimeline) {
        hover = this.data[j].changes[0];
        for (let i = 0; i<this.data[j].changes.length; i++) {
          if (this.data[j].changes[i].start > this.mouse.position.ts) {
            break;
          }
          hover = this.data[j].changes[i];
        }
        this.hoverPoint = hover;

        if (showTT) {
          this.externalPT = isExternal;
          this.showTooltip( evt, hover, isExternal );
        }
        this.onRender(); // refresh the view
      } else if (!isExternal) {
        if (this.isStacked) {
          hover = this.data[j].legendInfo[0];
          for (let i = 0; i<this.data[j].legendInfo.length; i++) {
            if (this.data[j].legendInfo[i].x > this.mouse.position.x) {
              break;
            }
            hover = this.data[j].legendInfo[i];
          }
          this.hoverPoint = hover;
          this.onRender(); // refresh the view

          if (showTT) {
            this.externalPT = isExternal;
            this.showLegandTooltip(evt.evt, hover);
          }
        }
      }
    } else {
      this.$tooltip.detach(); // make sure it is hidden
    }
  }

  onMouseClicked(where) {
    var pt = this.hoverPoint;
    if (pt && pt.start) {
      var range = {from: moment.utc(pt.start), to: moment.utc(pt.start+pt.ms) };
      this.timeSrv.setTime(range);
      this.clear();
    }
  }

  onMouseSelectedRange(range) {
    this.timeSrv.setTime(range);
    this.clear();
  }

  clear() {
    this.mouse.position = null;
    this.mouse.down = null;
    this.hoverPoint = null;
    $(this.canvas).css( 'cursor', 'wait' );
    appEvents.emit('graph-hover-clear');
    this.render();
  }

  _updateRenderDimensions() {
    this._renderDimensions = {};

    var rect = this._renderDimensions.rect = this.wrap.getBoundingClientRect();
    var rows = this._renderDimensions.rows = this.data.length;
    var rowHeight = this._renderDimensions.rowHeight = this.panel.rowHeight;
    var height = this._renderDimensions.height = rowHeight * rows;
    var width = this._renderDimensions.width = rect.width;
    var rectHeight = this._renderDimensions.rectHeight = rowHeight;

    var top = 0;
    var elapsed = this.range.to - this.range.from;

    this._renderDimensions.matrix = [];
    _.forEach(this.data, metric => {
      var positions = [];

      if (this.isTimeline) {
        var lastBS = 0;
        var point = metric.changes[0];
        for (var i = 0; i < metric.changes.length; i++) {
          point = metric.changes[i];
          if (point.start <= this.range.to) {
            var xt = Math.max(point.start - this.range.from, 0);
            var x = (xt / elapsed) * width;
            positions.push(x);
          }
        }
      }

      if (this.isStacked) {
        var point = null;
        var start = this.range.from;
        for (var i = 0; i < metric.legendInfo.length; i++) {
          point = metric.legendInfo[i];
          var xt = Math.max(start - this.range.from, 0);
          var x = (xt / elapsed) * width;
          positions.push(x);
          start += point.ms;
        }
      }

      this._renderDimensions.matrix.push({
        y: top,
        positions: positions
      });

      top += rowHeight;
    });
  }

  _updateSelectionMatrix() {
    var selectionPredicates = {
      all: function () { return true; },
      crosshairHover: function (i, j) {
        if (j + 1 === this.data[i].changes.length) {
          return this.data[i].changes[j].start <= this.mouse.position.ts;
        }
        return this.data[i].changes[j].start <= this.mouse.position.ts &&
          this.mouse.position.ts < this.data[i].changes[j + 1].start;
      },
      mouseX: function (i, j) {
        var row = this._renderDimensions.matrix[i];
        if (j + 1 === row.positions.length) {
          return row.positions[j] <= this.mouse.position.x;
        }
        return row.positions[j] <= this.mouse.position.x &&
          this.mouse.position.x < row.positions[j + 1];
      },
      metric: function (i) {
        return this.data[i] === this._selectedMetric;
      },
      legendItem: function (i, j) {
        if (this.data[i] !== this._selectedMetric) {
          return false;
        }
        return this._selectedLegendItem.val === this._getVal(i, j);
      }
    }

    function getPredicate() {
      if (this._selectedLegendItem !== undefined) {
        return 'legendItem';
      };
      if (this._selectedMetric !== undefined) {
        return 'metric';
      };
      if (this.mouse.down !== null) {
        return 'all';
      }
      if (this.panel.highlightOnMouseover && this.mouse.position != null) {
        if (this.isTimeline) {
          return 'crosshairHover';
        }
        if (this.isStacked) {
          return 'mouseX';
        }
      }
      return 'all';
    }

    var pn = getPredicate.bind(this)();
    var predicate = selectionPredicates[pn].bind(this);
    this._selectionMatrix = [];
    for (var i = 0; i < this._renderDimensions.matrix.length; i++) {
      var rs = [];
      var r = this._renderDimensions.matrix[i];
      for (var j = 0; j < r.positions.length; j++) {
        rs.push(predicate(i, j));
      }
      this._selectionMatrix.push(rs);
    }
  }

  _updateCanvasSize() {
    this.canvas.width = this._renderDimensions.width * this._devicePixelRatio;
    this.canvas.height = this._renderDimensions.height * this._devicePixelRatio;

    $(this.canvas).css('width', this._renderDimensions.width + 'px');
    $(this.canvas).css('height', this._renderDimensions.height + 'px');

    this.context.scale(this._devicePixelRatio, this._devicePixelRatio);
  }

  _getVal(metricIndex, rectIndex) {
    var point = undefined;
    if (this.isTimeline) { point = this.data[metricIndex].changes[rectIndex]; }
    if (this.isStacked) { point = this.data[metricIndex].legendInfo[rectIndex]; }
    return point.val;
  }

  _getWidth(metricIndex, rectIndex) {
    var positions = this._renderDimensions.matrix[metricIndex].positions;
    if (rectIndex + 1 === positions.length) {
      return this._renderDimensions.width - positions[rectIndex];
    }
    return positions[rectIndex + 1] - positions[rectIndex];
  }

  _renderRects() {
    var matrix = this._renderDimensions.matrix;
    var ctx = this.context;
    _.forEach(this.data, (metric, i) => {
      var rowObj = matrix[i];
      for (var j = 0; j < rowObj.positions.length; j++) {
        var currentX = rowObj.positions[j];
        var nextX = this._renderDimensions.width;
        if (j + 1 !== rowObj.positions.length) {
          nextX = rowObj.positions[j + 1];
        }
        ctx.fillStyle = this.getColor(this._getVal(i, j));
        var globalAlphaTemp = ctx.globalAlpha;
        if (!this._selectionMatrix[i][j]) {
          ctx.globalAlpha = 0.3;
        }
        ctx.fillRect(
          currentX, matrix[i].y,
          nextX - currentX, this._renderDimensions.rectHeight
        );
        ctx.globalAlpha = globalAlphaTemp;
      }
    });
  }

  _renderLabels() {
    var ctx = this.context;
    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';
    ctx.font = this.panel.textSize + 'px "Open Sans", Helvetica, Arial, sans-serif';

    function findLength(text, width) {
      for (var length = 1; length < text.length + 1; length++) {
        var testLine = text.substr(0, length);
        var measure = ctx.measureText(testLine);
        if (measure.width > width) {
          break;
        }
      }

      return text.substr(0, length - 1);
    }

    _.forEach(this.data, (metric, i) => {
      var { y, positions } = this._renderDimensions.matrix[i];
      var rectHeight = this._renderDimensions.rectHeight;

      var centerV = y + (rectHeight / 2);
      var labelPositionMetricName = y + rectHeight - this.panel.textSize / 2;
      var labelPositionLastValue = y + rectHeight - this.panel.textSize / 2;
      var labelPositionValue = y + this.panel.textSize / 2;

      if (this.mouse.position == null) {
        if (this.panel.writeMetricNames) {
          ctx.fillStyle = this.panel.metricNameColor;
          ctx.textAlign = 'left';
          ctx.fillText(metric.name, 10, labelPositionMetricName);
        }
        if (this.panel.writeLastValue) {
          var val = this._getVal(i, positions.length - 1);
          ctx.fillStyle = this.panel.valueTextColor;
          ctx.textAlign = 'right';
          ctx.fillText(val, this._renderDimensions.width, labelPositionLastValue);
        }
      } else {
        for (var j = 0; j < positions.length; j++) {
          if (positions[j] <= this.mouse.position.x) {
            if (j >= positions.length - 1 || positions[j + 1] >= this.mouse.position.x) {
              var val = this._getVal(i, j);
              ctx.fillStyle = this.panel.valueTextColor;
              ctx.textAlign = 'left';
              ctx.fillText(val, positions[j], labelPositionValue);
              break;
            }
          }
        }
      }

      if (this.panel.writeAllValues) {
        ctx.fillStyle = this.panel.valueTextColor;
        ctx.textAlign = 'left';
        for (var j = 0; j < positions.length; j++) {
          var val = this._getVal(i, j);
          var width = this._getWidth(i, j);
          var cval = findLength(val, width);
          ctx.fillText(cval, positions[j], labelPositionValue);
        }
      }
    });
  }

  _renderSelection() {
    if (this.mouse.down === null) {
      return;
    }
    if (this.mouse.position === null) {
      return;
    }
    if (!this.isTimeline) {
      return;
    }

    var ctx = this.context;
    var height = this._renderDimensions.height;

    var xmin = Math.min(this.mouse.position.x, this.mouse.down.x);
    var xmax = Math.max(this.mouse.position.x, this.mouse.down.x);

    ctx.fillStyle = "rgba(110, 110, 110, 0.5)";
    ctx.strokeStyle = "rgba(110, 110, 110, 0.5)";
    ctx.beginPath();
    ctx.fillRect(xmin, 0, xmax - xmin, height);
    ctx.strokeRect(xmin, 0, xmax - xmin, height);
  }

  _renderCrosshair() {
    if (this.mouse.down != null) {
      return;
    }
    if (this.mouse.position === null) {
      return;
    }
    if (!this.isTimeline) {
      return;
    }

    var ctx = this.context;
    var rows = this.data.length;
    var rowHeight = this.panel.rowHeight;
    var height = this._renderDimensions.height;

    ctx.beginPath();
    ctx.moveTo(this.mouse.position.x, 0);
    ctx.lineTo(this.mouse.position.x, height);
    ctx.strokeStyle = this.panel.crosshairColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (this.externalPT && rows > 1) {
      ctx.beginPath();
      ctx.arc(this.mouse.position.x, this.mouse.position.y, 3, 0, 2 * Math.PI, false);
      ctx.fillStyle = this.panel.crosshairColor;
      ctx.fill();
      ctx.lineWidth = 1;
    }
  }
}

export {
  DiscretePanelCtrl as PanelCtrl
};


