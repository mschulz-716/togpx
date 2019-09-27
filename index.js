import GPX from 'gpx-parser-builder';

function togpx( geojson, options ) {
  options = (function (defaults, options) {
    for (var k in defaults) {
      if (options.hasOwnProperty(k))
        defaults[k] = options[k];
    }
    return defaults;
  })({
    creator: "togpx",
    metadata: undefined,
    featureTitle: get_feature_title,
    featureDescription: get_feature_description,
    featureLink: undefined,
    featureCoordTimes: get_feature_coord_times,
  }, options || {});

  // is featureCoordTimes is a string -> look for the specified property
  if (typeof options.featureCoordTimes === 'string') {
    var customTimesFieldKey = options.featureCoordTimes;
    options.featureCoordTimes = function (feature) {
      return feature.properties[customTimesFieldKey];
    }
  }

  function get_feature_title(props) {
    // a simple default heuristic to determine a title for a given feature
    // uses a nested `tags` object or the feature's `properties` if present
    // and then searchs for the following properties to construct a title:
    // `name`, `ref`, `id`
    if (!props) return "";
    if (typeof props.tags === "object") {
      var tags_title = get_feature_title(props.tags);
      if (tags_title !== "")
        return tags_title;
    }
    if (props.name)
      return props.name;
    if (props.ref)
      return props.ref;
    if (props.id)
      return props.id;
    return "";
  }
  function get_feature_description(props) {
    // constructs a description for a given feature
    // uses a nested `tags` object or the feature's `properties` if present
    // and then concatenates all properties to construct a description.
    if (!props) return "";
    if (typeof props.tags === "object")
      return get_feature_description(props.tags);
    var res = "";
    for (var k in props) {
      if (typeof props[k] === "object")
        continue;
      res += k+"="+props[k]+"\n";
    }
    return res.substr(0,res.length-1);
  }
  function get_feature_coord_times(feature) {
    if (!feature.properties) return null;
    return feature.properties.times || feature.properties.coordTimes || null;
  }
  function add_feature_link(o, f) {
    if (options.featureLink)
      o.link = { "@href": options.featureLink(f.properties) }
  }

  // convert the togpx gpx object to an object which can be used by gpx-parser-builder
  function toGpxBuilderObject(gpx) {
    let gpxBuilderObject = {};
    for (let prop in gpx) {
      if( gpx.hasOwnProperty( prop ) ) {
        console.log("o." + prop + " = " + gpx[prop]);
        if (prop.startsWith('@')) {
          const key = prop.substr(1);
          if (!gpxBuilderObject['$']) {
            gpxBuilderObject['$'] = {};
          }
          if (typeof gpx[prop] === 'object') {
            if (gpx[prop] instanceof Array) {
              gpxBuilderObject['$'][key] = gpx[prop].map(item => {return toGpxBuilderObject(item)});
            } else {
              gpxBuilderObject['$'][key] = toGpxBuilderObject(gpx[prop]);
            }
          } else {
            gpxBuilderObject['$'][key] = gpx[prop];
          }
        } else {
          if (typeof gpx[prop] === 'object') {
            if (gpx[prop] instanceof Array) {
              gpxBuilderObject[prop] = gpx[prop].map(item => {return toGpxBuilderObject(item)});
            } else {
              gpxBuilderObject[prop] = toGpxBuilderObject(gpx[prop]);
            }
          } else {
            gpxBuilderObject[prop] = gpx[prop];
          }
        }
      } 
    }
    return gpxBuilderObject;
  }
  
  // make gpx object
  var gpx = {"gpx": {
    "@xmlns":"http://www.topografix.com/GPX/1/1",
    "@xmlns:xsi":"http://www.w3.org/2001/XMLSchema-instance",
    "@xsi:schemaLocation":"http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd",
    "@version":"1.1",
    "metadata": null,
    "wpt": [],
    "trk": [],
  }};
  if (options.creator)
    gpx.gpx["@creator"] = options.creator;
  if (options.metadata)
    gpx.gpx["metadata"] = options.metadata;
  else
    delete options.metadata;

  var features;
  if (geojson.type === "FeatureCollection")
    features = geojson.features;
  else if (geojson.type === "Feature")
    features = [geojson];
  else
    features = [{type:"Feature", properties: {}, geometry: geojson}];
  let o = {};
  features.forEach(function mapFeature(f) {
    switch (f.geometry.type) {
    // POIs
    case "Point":
    case "MultiPoint":
      var coords = f.geometry.coordinates;
      if (f.geometry.type == "Point") coords = [coords];
      coords.forEach(function (coordinates) {
        let pt = {
          "@lat": coordinates[1],
          "@lon": coordinates[0],
          "name": options.featureTitle(f.properties),
          "desc": options.featureDescription(f.properties)
        };
        if (coordinates[2] !== undefined) {
          pt.ele = coordinates[2];
        }
        add_feature_link(pt,f);
        gpx.gpx.wpt.push(pt);
      });
      break;
    // LineStrings
    case "LineString":
    case "MultiLineString":
      var coords = f.geometry.coordinates;
      var times = options.featureCoordTimes(f);
      if (f.geometry.type == "LineString") coords = [coords];
      o = {
        "name": options.featureTitle(f.properties),
        "desc": options.featureDescription(f.properties)
      };
      add_feature_link(o,f);
      o.trkseg = [];
      coords.forEach(function(coordinates) {
        var seg = {trkpt: []};
        coordinates.forEach(function(c, i) {
          let pt = {
            "@lat": c[1],
            "@lon":c[0]
          };
          if (c[2] !== undefined) {
            pt.ele = c[2];
          }
          if (times && times[i]) {
            pt.time = times[i];
          }
          seg.trkpt.push(pt);
        });
        o.trkseg.push(seg);
      });
      gpx.gpx.trk.push(o);
      break;
    // Polygons / Multipolygons
    case "Polygon":
    case "MultiPolygon":
      o = {
        "name": options.featureTitle(f.properties),
        "desc": options.featureDescription(f.properties)
      };
      add_feature_link(o,f);
      o.trkseg = [];
      var coords = f.geometry.coordinates;
      var times = options.featureCoordTimes(f);
      if (f.geometry.type == "Polygon") coords = [coords];
      coords.forEach(function(poly) {
        poly.forEach(function(ring) {
          var seg = {trkpt: []};
          var i = 0;
          ring.forEach(function(c) {
            let o = {
              "@lat": c[1],
              "@lon":c[0]
            };
            if (c[2] !== undefined) {
              o.ele = c[2];
            }
            if (times && times[i]) {
              o.time = times[i];
            }
            i++;
            seg.trkpt.push(o);
          });
          o.trkseg.push(seg);
        });
      });
      gpx.gpx.trk.push(o);
      break;
    case "GeometryCollection":
      f.geometry.geometries.forEach(function (geometry) {
        var pseudo_feature = {
          "properties": f.properties,
          "geometry": geometry
        };
        mapFeature(pseudo_feature);
      });
      break;
    default:
      console.log("warning: unsupported geometry type: "+f.geometry.type);
    }
  });
  let gpxBuilderObject = toGpxBuilderObject(gpx.gpx);
  const gpx_str = new GPX(gpxBuilderObject).toString();
  return gpx_str;
};

export default togpx;
