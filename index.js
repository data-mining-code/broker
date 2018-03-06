const serverRouter = require('server-router')
const r2 = require('r2')
const exec = require('execall')
const firebase = require('firebase')
const algoliasearch = require('algoliasearch')
const http = require('http')
const url = require('url')
const querystring = require('querystring')
const intents = require('./intents.json')
const { each } = require('async')

const router = serverRouter()

const config = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET
}
firebase.initializeApp(config)
const database = firebase.database()

const algolia = algoliasearch(process.env.ALGOLIA_APP_ID, process.env.ALGOLIA_API_KEY)
const index = algolia.initIndex('products')

const clients = [
  {
    "name": "stock",
    "regex": /(?:is(?: there)?|do you have) ([\s\S]+) in stock(?: at (\w+))?/i,
    "arguments": [
      {
        "name": "product",
        "index": 0
      },
      {
        "name": "location",
        "index": 1,
        "optional": true
      }
    ]
  },
  {
    "name": "discount",
    "regex": /(?:is(?: there)?|do we have) ([\s\S]+) (?:on discount|on sale)(?: at (\w+))?/i,
    "arguments": [
      {
        "name": "product",
        "index": 0
      },
      {
        "name": "location",
        "index": 1,
        "optional": true
      }
    ]
  },
  {
    "name": "hours",
    "regex": /(?:(?:what|when) are you(?:r)? (?:opening hours|open))(?: at (\w+))?/i,
    "arguments": [
      {
        "name": "location",
        "index": 0,
        "optional": true
      }
    ]
  },
  {
    "name": "all_locations",
    "regex": /(?:where do you have (?:shops|stores)|how many shops do you have)(?: in (\w+))?/i,
    "arguments": [
      {
        "name": "location",
        "index": 0,
        "optional": true
      }
    ]
  },
  {
    "name": "location",
    "regex": /(?:(?:do you have a|is there a) (?:shop|store))(?: in (\w+))?/i,
    "arguments": [
      {
        "name": "location",
        "index": 0
      }
    ]
  },
  {
    "name": "address",
    "regex": /(?:where is your (?:shop|store) (?:in|at)) (\w+)?/i,
    "arguments": [
      {
        "name": "location",
        "index": 0
      }
    ]
  },
  {
    "name": "notfound",
    "regex": /.*/
  }
]

function processinput(query,text_string,input,cb) {
  const input_list = input.toLowerCase().replace(/\,|\?/g , '').split(" ")
  
  //Generate empty query object ready to be filled
  intents.forEach(function(intent) {
    query[intent['tag']] = []
  })
  query['products'] = []

  //Create all Combinations of Input words and list words that must be iterated over
  let iteritems = []
  input_list.forEach(input_word => {
    intents.forEach(intent => {
      intent['words'].forEach(intent_word => {
        intent_word.split(" ").forEach(intent_word_list_word => {
          iteritems.push({
            input_word,
            intent,
            intent_word,
            intent_word_list_word
          })
        })
      })
    })
  })
  console.log(Array.from(new Set(iteritems.map(e => e.input_word))))

  //Which Words have been already found in the input string
  let found = []  
  
  //Iterate over the Array and check if the input_word matches a fraction of the intent_word
  iteritems.forEach(obj => {
    if (obj.input_word === obj.intent_word_list_word) {
      query[obj.intent['tag']].push(obj.intent_word)
      text_string += obj.intent_word
      found.push(obj.input_word)
      console.log(text_string)
    }
  })

  //For every item that was not yet found call the API to look if you found a product
  each(iteritems, function(obj, callback) {
    if (!found.includes(obj.input_word)) {
      found.push(obj.input_word)
      index.search(obj.input_word, function searchDone(err, content, callbac) {
        if (err) {
          console.error(err);
          callback(err)
        }
        for (var h in content.hits) {
          if (h == 0) {
            text_string += content.hits[h].name
          }
          console.log(
            `In Hit(${content.hits[h].objectID}) for ${obj.input_word}`
          )
        }
        console.log('Pre callback() for ', obj.input_word)    
        callback();
        console.log('Post callback() for ', obj.input_word)     
      })
      console.log('Post search for', obj.input_word)
    }
  }, function(err) {
    console.log('Pre cb()')
    cb()
  });
  console.log('Post each')
}

function getclient(query) {
  //Figure out the kind of request based on a few keywords
  let qword = query['questionword'] 
  let q_key_word = query['question_key_words']
  let p_key_word = query['product_key_words']
  let location = query['location']
  if (qword == 'is' || qword == 'have' && q_key_word == 'stock') {
    query['client'] = 'stock'
  } else if ((qword === 'is' || qword === 'have') && (q_key_word === 'discount' || q_key_word === 'sale')) {
    query['client'] = 'discount'
  } else if ((qword === 'is' || qword === 'have') && p_key_word.length > 0) {
    query['client'] = 'discription'
  } else if ((qword === 'when' || qword === 'what' || qword === 'are' || qword === 'is') && (q_key_word === 'open' || q_key_word === 'hours')) {
    query['client'] = 'hours'
  } else if ((qword === 'where' || qword === 'have') && (q_key_word === 'store' || q_key_word === 'shop') && location.length === 0) {
    query['client'] = 'all_locations'
  } else if ((qword === 'where' || qword === 'have') && (q_key_word === 'store' || q_key_word === 'shop') && location.length > 0) {
    query['client'] = 'locations'
  } else {
    query['client'] = 'not_found'
  }
  Object.keys(query).map(function(objectKey, index) {
    console.log(objectKey, ': ', query[objectKey])
  });
}

router.route('GET', '/api/request', async (req, res) => {
  const timestamp = Date.now()
  const input = querystring.parse(url.parse(req.url).query).input
  var text_string = ""
  const query = {}
  processinput(query,text_string,input,function() {
    console.log('Pre Query')
    getclient(query)
    
    let qs
    Object.keys(query).map(function(objectKey, index) {
      if (index = 0) { qs += `?` }
      else { qs += '&'}
      qs += query[objectKey];
    });
  /*
    const obj = {
      text: input,
      query: query,
    }
    firebase.database().ref(`logs/${timestamp}/request`).set(obj)
    */
    let response = text_string
    if (client.name === 'notfound') {
      response = `Sorry, I don't understand.`
    } else {
      response = await r2(`http://pythontest${qs}`).text
    }
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    })
    /*database.ref(`logs/${timestamp}/response`).set({
      text: response
    })
    .catch(function(error) {
      console.log(error)
    });*/
    console.log('Send')
    res.end(JSON.stringify({text:response}))  
  })
})

http.createServer(router.start()).listen(3030)
