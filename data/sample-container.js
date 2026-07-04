/*
 * sample-container.js
 * -----------------------------------------------------------------------------
 * A realistic (but synthetic) GA4 GTM container export, embedded as a JS global
 * so the app works from file:// with no fetch/CORS issues.
 *
 * It deliberately exercises every transformation the tool visualizes:
 *   - event rename:      dataLayer "click"  -> GA4 event "click_on_component"
 *   - event pass-through: dataLayer "view_item" -> GA4 "view_item"
 *   - field rename:      color_name -> color, product_price -> value, ...
 *   - custom JS derive:  product_price -> {{CJS - currency}} -> GA field "currency"
 *   - lookup table:      category_code -> {{Lookup - category}} -> "item_category"
 *   - ignored tags:      Meta Pixel (html), Google Ads (awct) — must be skipped
 */
window.SAMPLE_CONTAINER = {
  "exportFormatVersion": 2,
  "containerVersion": {
    "container": { "name": "Demo Shop — GA4", "publicId": "GTM-DEMO123" },
    "tag": [
      {
        "tagId": "1",
        "name": "GA4 - click_on_component",
        "type": "gaawe",
        "parameter": [
          { "type": "TEMPLATE", "key": "eventName", "value": "click_on_component" },
          { "type": "LIST", "key": "eventSettingsTable", "list": [
            { "type": "MAP", "map": [
              { "type": "TEMPLATE", "key": "parameter", "value": "color" },
              { "type": "TEMPLATE", "key": "parameterValue", "value": "{{DLV - color_name}}" }
            ]},
            { "type": "MAP", "map": [
              { "type": "TEMPLATE", "key": "parameter", "value": "component_id" },
              { "type": "TEMPLATE", "key": "parameterValue", "value": "{{DLV - component_id}}" }
            ]},
            { "type": "MAP", "map": [
              { "type": "TEMPLATE", "key": "parameter", "value": "currency" },
              { "type": "TEMPLATE", "key": "parameterValue", "value": "{{CJS - currency from price}}" }
            ]}
          ]},
          { "type": "LIST", "key": "userProperties", "list": [
            { "type": "MAP", "map": [
              { "type": "TEMPLATE", "key": "name", "value": "user_tier" },
              { "type": "TEMPLATE", "key": "value", "value": "{{DLV - membership_level}}" }
            ]},
            { "type": "MAP", "map": [
              { "type": "TEMPLATE", "key": "name", "value": "logged_in" },
              { "type": "TEMPLATE", "key": "value", "value": "{{DLV - is_logged_in}}" }
            ]}
          ]},
          { "type": "TAG_REFERENCE", "key": "measurementId", "value": "Google Tag - Config" }
        ],
        "firingTriggerId": ["101"]
      },
      {
        "tagId": "2",
        "name": "GA4 - view_item",
        "type": "gaawe",
        "parameter": [
          { "type": "TEMPLATE", "key": "eventName", "value": "view_item" },
          { "type": "LIST", "key": "eventSettingsTable", "list": [
            { "type": "MAP", "map": [
              { "type": "TEMPLATE", "key": "parameter", "value": "value" },
              { "type": "TEMPLATE", "key": "parameterValue", "value": "{{DLV - product_price}}" }
            ]},
            { "type": "MAP", "map": [
              { "type": "TEMPLATE", "key": "parameter", "value": "item_name" },
              { "type": "TEMPLATE", "key": "parameterValue", "value": "{{DLV - product_name}}" }
            ]}
          ]},
          { "type": "TEMPLATE", "key": "eventSettingsVariable", "value": "{{Event Settings - Common}}" },
          { "type": "TAG_REFERENCE", "key": "measurementId", "value": "Google Tag - Config" }
        ],
        "firingTriggerId": ["102"]
      },
      {
        "tagId": "3",
        "name": "GA4 - add_to_cart",
        "type": "gaawe",
        "parameter": [
          { "type": "TEMPLATE", "key": "eventName", "value": "add_to_cart" },
          { "type": "LIST", "key": "eventSettingsTable", "list": [
            { "type": "MAP", "map": [
              { "type": "TEMPLATE", "key": "parameter", "value": "value" },
              { "type": "TEMPLATE", "key": "parameterValue", "value": "{{DLV - product_price}}" }
            ]},
            { "type": "MAP", "map": [
              { "type": "TEMPLATE", "key": "parameter", "value": "item_category" },
              { "type": "TEMPLATE", "key": "parameterValue", "value": "{{Lookup - category map}}" }
            ]}
          ]},
          { "type": "TAG_REFERENCE", "key": "measurementId", "value": "Google Tag - Config" }
        ],
        "firingTriggerId": ["103"]
      },
      {
        "tagId": "4",
        "name": "Google Tag - Config",
        "type": "googtag",
        "parameter": [
          { "type": "TEMPLATE", "key": "tagId", "value": "G-DEMO12345" },
          { "type": "LIST", "key": "configSettingsTable", "list": [
            { "type": "MAP", "map": [
              { "type": "TEMPLATE", "key": "parameter", "value": "currency" },
              { "type": "TEMPLATE", "key": "parameterValue", "value": "{{DLV - currency_code}}" }
            ]},
            { "type": "MAP", "map": [
              { "type": "TEMPLATE", "key": "parameter", "value": "country" },
              { "type": "TEMPLATE", "key": "parameterValue", "value": "{{DLV - geo_country}}" }
            ]}
          ]},
          { "type": "LIST", "key": "userProperties", "list": [
            { "type": "MAP", "map": [
              { "type": "TEMPLATE", "key": "name", "value": "customer_segment" },
              { "type": "TEMPLATE", "key": "value", "value": "{{DLV - segment}}" }
            ]}
          ]}
        ],
        "firingTriggerId": ["2147479553"]
      },
      {
        "tagId": "5",
        "name": "Meta Pixel - PageView",
        "type": "html",
        "parameter": [
          { "type": "TEMPLATE", "key": "html", "value": "<script>/* fbq pageview */</script>" }
        ],
        "firingTriggerId": ["2147479553"]
      },
      {
        "tagId": "6",
        "name": "Google Ads - Purchase Conversion",
        "type": "awct",
        "parameter": [
          { "type": "TEMPLATE", "key": "conversionId", "value": "AW-000000000" }
        ],
        "firingTriggerId": ["104"]
      }
    ],
    "trigger": [
      {
        "triggerId": "101",
        "name": "CE - click",
        "type": "CUSTOM_EVENT",
        "customEventFilter": [
          { "type": "EQUALS", "parameter": [
            { "type": "TEMPLATE", "key": "arg0", "value": "{{_event}}" },
            { "type": "TEMPLATE", "key": "arg1", "value": "click" }
          ]}
        ]
      },
      {
        "triggerId": "102",
        "name": "CE - view_item",
        "type": "CUSTOM_EVENT",
        "customEventFilter": [
          { "type": "EQUALS", "parameter": [
            { "type": "TEMPLATE", "key": "arg0", "value": "{{_event}}" },
            { "type": "TEMPLATE", "key": "arg1", "value": "view_item" }
          ]}
        ]
      },
      {
        "triggerId": "103",
        "name": "CE - add_to_cart",
        "type": "CUSTOM_EVENT",
        "customEventFilter": [
          { "type": "EQUALS", "parameter": [
            { "type": "TEMPLATE", "key": "arg0", "value": "{{_event}}" },
            { "type": "TEMPLATE", "key": "arg1", "value": "add_to_cart" }
          ]}
        ]
      },
      {
        "triggerId": "104",
        "name": "CE - purchase",
        "type": "CUSTOM_EVENT",
        "customEventFilter": [
          { "type": "EQUALS", "parameter": [
            { "type": "TEMPLATE", "key": "arg0", "value": "{{_event}}" },
            { "type": "TEMPLATE", "key": "arg1", "value": "purchase" }
          ]}
        ]
      }
    ],
    "variable": [
      { "variableId": "201", "name": "DLV - color_name", "type": "v",
        "parameter": [
          { "type": "INTEGER", "key": "dataLayerVersion", "value": "2" },
          { "type": "TEMPLATE", "key": "name", "value": "color_name" }
        ]},
      { "variableId": "202", "name": "DLV - component_id", "type": "v",
        "parameter": [
          { "type": "INTEGER", "key": "dataLayerVersion", "value": "2" },
          { "type": "TEMPLATE", "key": "name", "value": "component_id" }
        ]},
      { "variableId": "203", "name": "DLV - product_price", "type": "v",
        "parameter": [
          { "type": "INTEGER", "key": "dataLayerVersion", "value": "2" },
          { "type": "TEMPLATE", "key": "name", "value": "ecommerce.price" }
        ]},
      { "variableId": "204", "name": "DLV - product_name", "type": "v",
        "parameter": [
          { "type": "INTEGER", "key": "dataLayerVersion", "value": "2" },
          { "type": "TEMPLATE", "key": "name", "value": "ecommerce.name" }
        ]},
      { "variableId": "205", "name": "DLV - category_code", "type": "v",
        "parameter": [
          { "type": "INTEGER", "key": "dataLayerVersion", "value": "2" },
          { "type": "TEMPLATE", "key": "name", "value": "category_code" }
        ]},
      { "variableId": "206", "name": "CJS - currency from price", "type": "jsm",
        "parameter": [
          { "type": "TEMPLATE", "key": "javascript",
            "value": "function() {\n  var price = {{DLV - product_price}};\n  return price > 100 ? 'EUR' : 'USD';\n}" }
        ]},
      { "variableId": "207", "name": "Lookup - category map", "type": "smm",
        "parameter": [
          { "type": "TEMPLATE", "key": "input", "value": "{{DLV - category_code}}" },
          { "type": "LIST", "key": "map", "list": [
            { "type": "MAP", "map": [
              { "type": "TEMPLATE", "key": "key", "value": "APP" },
              { "type": "TEMPLATE", "key": "value", "value": "Apparel" }
            ]}
          ]},
          { "type": "TEMPLATE", "key": "defaultValue", "value": "Other" }
        ]},
      { "variableId": "208", "name": "DLV - membership_level", "type": "v",
        "parameter": [{ "type": "TEMPLATE", "key": "name", "value": "membership_level" }]},
      { "variableId": "209", "name": "DLV - is_logged_in", "type": "v",
        "parameter": [{ "type": "TEMPLATE", "key": "name", "value": "is_logged_in" }]},
      { "variableId": "210", "name": "DLV - currency_code", "type": "v",
        "parameter": [{ "type": "TEMPLATE", "key": "name", "value": "currency_code" }]},
      { "variableId": "211", "name": "DLV - geo_country", "type": "v",
        "parameter": [{ "type": "TEMPLATE", "key": "name", "value": "geo_country" }]},
      { "variableId": "212", "name": "DLV - segment", "type": "v",
        "parameter": [{ "type": "TEMPLATE", "key": "name", "value": "segment" }]},
      { "variableId": "213", "name": "DLV - pageType", "type": "v",
        "parameter": [{ "type": "TEMPLATE", "key": "name", "value": "pageType" }]},
      { "variableId": "214", "name": "Event Settings - Common", "type": "gtes",
        "parameter": [
          { "type": "LIST", "key": "eventSettingsTable", "list": [
            { "type": "MAP", "map": [
              { "type": "TEMPLATE", "key": "parameter", "value": "page_type" },
              { "type": "TEMPLATE", "key": "parameterValue", "value": "{{DLV - pageType}}" }
            ]}
          ]}
        ]}
    ]
  }
};
