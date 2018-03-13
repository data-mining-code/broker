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
index.setSettings({
  attributesToHighlight: [
    'name',
    'description',
    'category',
    'brand'
  ]
});

async function processinput(query,input,cb) {
  return new Promise(async (resolve, reject) => {
    const input_list = input
      .toLowerCase()
      .replace(/\,|\?/g , '')
      .split(" ")
    
    //Generate empty query object ready to be filled
    intents.forEach(function(intent) {
      query[intent['tag']] = ""
    })
    query['productid'] = ""
    query['notmatched'] = ""

    //Create all Combinations of Input words and list words that must be iterated over
    let iteritems = []
    input_list.forEach(input_word => {
      intents.forEach(intent => {
        if (intent['tag'] == 'noncapture') {
        } else {
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
        }
      })
    })

    //Which Words have been already found in the input string
    let found = []  
    
    //Iterate over the Array and check if the input_word matches a fraction of the intent_word
    iteritems.forEach(obj => {
      if (obj.input_word === obj.intent_word_list_word) {
        query[obj.intent['tag']] = obj.intent_word
        found.push(obj.input_word)
      }
    })
    let notmatched = ''
    input_list.map((word) =>{
      if (!found.includes(word) && word.length > 2 && !intents[7]['words'].includes(word)) {
        notmatched = notmatched + word + " "
        query['notmatched'] = word 
      }
    })

    //For every item that was not yet found call the API to look if you found a product
    //console.log('NotMatched: ', notmatched)
    const results = await runSearch(notmatched)
    if (results) {
      //console.log('Exaxtly one: ', results['hits'])
      query['product'] = results['hits'][0]['objectID']
    } else {
      //Empty
    }
    resolve(results)
  })
}

async function runSearch(input) {
  return new Promise(async (resolve, reject) => {
    const results = await algoliaSearch(input)
    //console.log(results)
    resolve(results)
  })
}

function algoliaSearch(input) {
  return new Promise((resolve, reject) => {
    index.search({query: input, getRankingInfo: true}, (err, content) => {
      if (err) {
        console.error(err);
        reject(err)
      }
      var result
      if (content.hits) {
        result = {input, hits: content.hits.slice(0, 5)}
      }
      resolve(result)   
    })
  })
}

function getclient(query) {
  //Figure out the kind of request based on a few keywords
  let qword = query['question_words']
  let q_key_word = query['question_key_words']
  let p_key_word = query['product_key_words']
  let location = query['location']
  let verb = query['verb']
  if ((verb == 'is' || verb == 'are' || verb == 'have' || verb == 'has') && q_key_word == 'stock') {
    query['client'] = 'stock'
  } else if ((verb === 'is' || verb === 'have') && (q_key_word === 'discount' || q_key_word === 'sale')) {
    query['client'] = 'discount'
  } else if ((verb === 'is' || verb === 'have') && p_key_word.length > 0) {
    query['client'] = 'description'
  } else if ((qword === 'when' || qword === 'what' || verb === 'are' || verb === 'is') && (q_key_word === 'open' || q_key_word === 'hours')) {
    query['client'] = 'hours'
  } else if ((qword === 'where' || verb === 'have') && (q_key_word === 'stores' || q_key_word === 'shops') && location.length === 0) {
    query['client'] = 'all_locations'
  } else if ((qword === 'do') && (verb === 'have') && (q_key_word === 'store' || q_key_word === 'shop') && location.length > 0) {
    query['client'] = 'location'
  } else if ((qword === 'where') && (q_key_word === 'store' || q_key_word === 'shop') && location.length > 0) {
    query['client'] = 'address'
  } else {
    query['client'] = 'not_found'
  }
  // Object.keys(query).map(function(objectKey, index) {
  //   console.log(objectKey, ': ', query[objectKey])
  // });
}

function save_request(timestamp, sessid, input, query) {
  const request = {
    text: input,
    query: query,
  }

  if (sessid == 'undefined') {
    console.log('undefined')
    sessid = timestamp
    firebase.database().ref(`logs/${sessid}`).set({
      sentiment: 'undefined'
    })
    .catch(function(error) {
      console.log(error)
    });
  }
  var chat = firebase.database().ref(`logs/${sessid}/chat`)
  var newaction = chat.push({
    request: request
  })
  var actionid = newaction.key
  return {sessid, actionid}
}

router.route('GET', '/api/request', async (req, res) => {
  const timestamp = Date.now()
  const input = querystring.parse(url.parse(req.url).query).input
  var sessid = querystring.parse(url.parse(req.url).query).id
  const query = {}
  var results = await processinput(query,input)
  getclient(query)
  
  let qs = `?client=${query['client']}`
  Object.keys(query).map((objectKey, index) => {
    if (query[objectKey] != '' && objectKey != 'client') {
      if (index = 0) { qs += `?` }
      else { qs += '&'}
      qs = qs + objectKey + '=' + query[objectKey];
    }
  });
  //console.log(qs)
  
  var {sessid, actionid} = save_request(timestamp, sessid, input, query)
  
  if (query['client'] === 'not_found') {
    response = `Sorry, I don't understand.`
  } else {
    response = await r2(`http://pythontest${qs}`).text
  }
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*', 
    'Content-Type': 'application/json'
  })
  database.ref(`logs/${sessid}/chat/${actionid}/response`).set({
    text: response
  })
  .catch(function(error) {
    console.log(error)
  });
  res.end(JSON.stringify({
    text:response,
    id:sessid
  }))  
})

http.createServer(router.start()).listen(3030)

