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
  hoverPoint: any = null;
  colorMap: any = {};
  _colorsPaleteCash: any = null;
  unitFormats: any = null; // only used for editor
  formatter: any = null;

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

 //   console.log( 'render', this.data);

    var rect = this.wrap.getBoundingClientRect();

    var rows = this.data.length;
    var rowHeight = this.panel.rowHeight;

    var height = rowHeight * rows;
    var width = rect.width;
    this.canvas.width = width * this._devicePixelRatio;
    this.canvas.height = height * this._devicePixelRatio;

    $(this.canvas).css('width', width + 'px');
    $(this.canvas).css('height', height + 'px');

    var ctx = this.context;
    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';
    ctx.font = this.panel.textSize + 'px "Open Sans", Helvetica, Arial, sans-serif';

    ctx.scale(this._devicePixelRatio, this._devicePixelRatio);

    // ctx.shadowOffsetX = 1;
    // ctx.shadowOffsetY = 1;
    // ctx.shadowColor = "rgba(0,0,0,0.3)";
    // ctx.shadowBlur = 3;

    var top = 0;

    var elapsed = this.range.to - this.range.from;
    let point = null;

    _.forEach(this.data, (metric) => {
      var centerV = top + (rowHeight/2);

      // The no-data line
      ctx.fillStyle = this.panel.backgroundColor;
      ctx.fillRect(0, top, width, rowHeight);

      /*if(!this.panel.writeMetricNames) {
        ctx.fillStyle = "#111111";
        ctx.textAlign = 'left';
        ctx.fillText("No Data", 10, centerV);
      }*/
      if (this.isTimeline) {
        let lastBS = 0;
        point = metric.changes[0];
        for (let i = 0; i<metric.changes.length; i++) {
          point = metric.changes[i];
          if (point.start <= this.range.to) {
            let xt = Math.max( point.start - this.range.from, 0 );
            point.x = (xt / elapsed) * width;
            ctx.fillStyle = this.getColor( point.val );
            ctx.fillRect(point.x, top, width, rowHeight);

            if (this.panel.writeAllValues) {
              ctx.fillStyle = this.panel.valueTextColor;
              ctx.textAlign = 'left';
              ctx.fillText(point.val, point.x+7, centerV);
            }
            lastBS = point.x;
          }
        }
      } else if (this.panel.display === 'stacked') {
        point = null;
        let start = this.range.from;
        for (let i = 0; i<metric.legendInfo.length; i++) {
          point = metric.legendInfo[i];

          let xt = Math.max( start - this.range.from, 0 );
          point.x = (xt / elapsed) * width;
          ctx.fillStyle = this.getColor( point.val );
          ctx.fillRect(point.x, top, width, rowHeight);

          if (this.panel.writeAllValues) {
            ctx.fillStyle = this.panel.valueTextColor;
            ctx.textAlign = 'left';
            ctx.fillText(point.val, point.x+7, centerV);
          }

          start += point.ms;
        }
      } else {
        console.log( "Not supported yet...", this );
      }

      if (top>0) {
        ctx.strokeStyle = this.panel.lineColor;
        ctx.beginPath();
        ctx.moveTo(0, top);
        ctx.lineTo(width, top);
        ctx.stroke();
      }

      ctx.fillStyle = "#000000";

      if ( this.panel.writeMetricNames &&
          this.mouse.position == null &&
        (!this.panel.highlightOnMouseover || this.panel.highlightOnMouseover )
      ) {
        ctx.fillStyle = this.panel.metricNameColor;
        ctx.textAlign = 'left';
        ctx.fillText( metric.name, 10, centerV);
      }

      ctx.textAlign = 'right';

      if ( this.mouse.down == null ) {
        if ( this.panel.highlightOnMouseover && this.mouse.position != null ) {
          let next = null;

          if (this.isTimeline) {
            point = metric.changes[0];
            for (let i = 0; i<metric.changes.length; i++) {
              if (metric.changes[i].start > this.mouse.position.ts) {
                next = metric.changes[i];
                break;
              }
              point = metric.changes[i];
            }
          } else if (this.panel.display === 'stacked') {
            point = metric.legendInfo[0];
            for (let i = 0; i<metric.legendInfo.length; i++) {
              if (metric.legendInfo[i].x > this.mouse.position.x) {
                next = metric.legendInfo[i];
                break;
              }
              point = metric.legendInfo[i];
            }
          }

          // Fill canvas using 'destination-out' and alpha at 0.05
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
          ctx.beginPath();
          ctx.fillRect(0, top, point.x, rowHeight);
          ctx.fill();

          if (next != null) {
            ctx.beginPath();
            ctx.fillRect(next.x, top, width, rowHeight);
            ctx.fill();
          }
          ctx.globalCompositeOperation = 'source-over';

          // Now Draw the value
          ctx.fillStyle = "#000000";
          ctx.textAlign = 'left';
          ctx.fillText( point.val, point.x+7, centerV);
        } else if ( this.panel.writeLastValue ) {
          ctx.fillText( point.val, width-7, centerV );
        }
      }

      top += rowHeight;
    });



    if ( this.isTimeline && this.mouse.position != null ) {
      if (this.mouse.down != null) {
        var xmin = Math.min( this.mouse.position.x, this.mouse.down.x);
        var xmax = Math.max( this.mouse.position.x, this.mouse.down.x);

        // Fill canvas using 'destination-out' and alpha at 0.05
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        ctx.beginPath();
        ctx.fillRect(0, 0, xmin, height);
        ctx.fill();

        ctx.beginPath();
        ctx.fillRect(xmax, 0, width, height);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.strokeStyle = '#111';
        ctx.beginPath();
        ctx.moveTo(this.mouse.position.x, 0);
        ctx.lineTo(this.mouse.position.x, height);
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(this.mouse.position.x, 0);
        ctx.lineTo(this.mouse.position.x, height);
        ctx.strokeStyle = '#e22c14';
        ctx.lineWidth = 2;
        ctx.stroke();

        if (this.externalPT && rows>1) {
          ctx.beginPath();
          ctx.arc(this.mouse.position.x, this.mouse.position.y, 3, 0, 2 * Math.PI, false);
          ctx.fillStyle = '#e22c14';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = '#111';
          ctx.stroke();
        }
      }
    }
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
    this.isTimeline = true; //this.panel.display == 'timeline';

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
        if (this.panel.display === 'stacked') {
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
}

export {
  DiscretePanelCtrl as PanelCtrl
};


