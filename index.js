var packet = require('dns-packet')
var axios = require('axios')
var util = require('ethereumjs-util');
var SUPPORTED_ALGORITHM = 8;
var SUPPORTED_DIGESTS = 2;
var TRUST_ANCHORS = [
  {
    name: ".",
    type: "DS",
    // ttl: 3600,
    class: "IN",
    // flush: false,
    data:{
      keyTag: 19036,
      algorithm: 8,
      digestType: 2,
      digest: new Buffer("49AAC11D7B6F6446702E54A1607371607A1A41855200FD2CE1CDDE32F24E8FB5", "hex")
    }
  },
  {
    name: ".",
    type: "DS",
    // ttl: 3600,
    class: "IN",
    // flush: false,
    data:{
      keyTag: 20326,
      algorithm: 8,
      digestType: 2,      
      digest: new Buffer("E06D44B80B8F1D39A95C0B0D7C65D08458E880409BBC683457104237C7F8EC8D", "hex")
    }
  }
]

// TODO
// function supportsAlgorithm() {}
// function supportsDigest(){}

async function query(qtype, name){
  let buf = packet.encode({
    type: 'query',
    id: 1,
    flags: packet.RECURSION_DESIRED,
    questions: [{
      type: qtype,
      class: 'IN',
      name: name
    }],
    additionals: [{
      type: 'OPT',
      name: '.',
      udpPayloadSize: 4096,
      flags: packet.DNSSEC_OK
    }]
  })
  return  await getDNS(buf);
}
    
async function queryWithProof(qtype, name){
  let r = await query(qtype, name);
  console.log('* queryWithProof', qtype, name, r.answers.length)
  let sigs = await filterRRs(r.answers, 'RRSIG');
  let rrs = await getRRset(r.answers, name, qtype).catch((e)=>{ console.log("**ERROR", e)});
  let ret;
  for(const sig of sigs){
    ret = await verifyRRSet(sig, rrs);
    if(ret){
      ret.push([sig, rrs]);
      return ret;
    }
    // TODO: warn that it failed to verify RRSET
  }
  console.warn('Failed to verify RRSET');
}

async function verifyRRSet(sig, rrs) {
  // TODO: raise error if !client.supportsAlgorithm(sig.Algorithm)
  let sigHeaderName = sig.name;
  let rrsHeaderRtype = rrs[0].type;
  let sigdata = sig.data;
  let rrsdata = rrs[0].data[0];
  let sets;
  let keys = [];
  let signersName = sigdata.signersName;

  if(sigHeaderName == sigdata.signersName && rrsHeaderRtype == 'DNSKEY') {
    keys = rrs;
	}else{
    // Find the keys that signed this RRSET
    sets = await queryWithProof('DNSKEY', sigdata.signersName);
    if(sets){
      keys = sets[sets.length - 1][1];
    }else{
      console.log("**.* ERR")
    }
  }
  for(const key of keys){
    var header = getHeader(key);
    var digest = getDigest(key.name, header);
    var keyTag = getKeyTag(header);

    if(key.data.algorithm != sig.data.algorithm || keyTag != sig.data.keyTag || key.name != sig.data.signersName) {
      continue;
    }

    // TODO
    // sig.verify(key, rrs)
    if (sig.name == sig.data.signersName && rrsHeaderRtype == 'DNSKEY') {
      // RRSet is self-signed; look for DS records in parent zones to verify
      sets = await verifyWithDS(key)
    }
  }
  return sets;
}

function getHeader(key){
  return packet.dnskey.encode(key.data).slice(2);
}

function getDigest(name, input){
  return util.sha256(Buffer.concat([packet.name.encode(name), input]));
}

function getKeyTag(input){
  var keytag = 0;
  for(var i = 0; i < input.length; i++){
    var v = input[i];
    if (i & 1 != 0) {
      keytag += v
    } else {
      keytag += v << 8
    }
  }
  keytag += (keytag >> 16) & 0xFFFF;
  keytag &= 0xFFFF;
  return keytag;
}

async function verifyWithDS(key) {
  var header = getHeader(key);
  var digest = getDigest(key.name, header);
  var keyTag = getKeyTag(header);
  var matched = TRUST_ANCHORS.filter((anchor)=>{
    return (anchor.name == key.name) &&
           (anchor.data.algorithm == key.data.algorithm) &&
           (anchor.data.keyTag == keyTag) &&
           (digest.equals(anchor.data.digest))
  })
  // TODO: Check supportsDigest(ds.DigestType) {
  if(matched && matched.length > 0){
    return [];
  }

  // Look up the DS record
  sets = await queryWithProof('DS', key.name);
  // TODO: Validate DS records that validate DNSKEY
  sets[sets.length-1][1].forEach((ds)=>{
    // 	if !client.supportsDigest(ds.DigestType) {
    // 		continue
    // 	}
    if(ds.data.digest.compare(digest)){
      return sets;
    }
  })
  return sets;
}

async function filterRRs(rrs, qtype){
  return rrs.filter((r)=>{ return r.type == qtype });
}

async function getRRset(rrs, name, qtype){
  return rrs.filter((r)=>{ return r.type == qtype && r.name == name });
}

async function getDNS(buf) {
  let url = 'https://dns.google.com/experimental?ct=application/dns-udpwireformat&dns=';
  let response = await axios.get(url + buf.toString('base64'), { responseType:'arraybuffer' })
  let decoded = packet.decode(response.data);
  return decoded
}

function display(r){
  var header = [r.name, r.ttl, r.class, r.type];
  var data = Object.values(r.data);
  var row = header.concat(data);
  var type;
  row.unshift("//");
  switch(r.type){
    case 'DNSKEY':
      type = 'base64';
      break;
    case 'RRSIG':
      type = 'base64';
      break;
    case 'DS':
      type = 'hex';
      break;
    default:
      break;
  }
  row[row.length -1] = row[row.length -1].toString(type);
  return row.join("\t");
}

function pack(rrset, sig) {
  var lengthField = 2;
  const s1 = Object.assign({}, sig.data, {signature: new Buffer(0)});
  s1.signature = new Buffer(0);
  var sigEncoded = packet.rrsig.encode(s1);  
  var sigwire = sigEncoded.slice(lengthField);
  var rrdata  = rawSignatureData(rrset, sig);
  return [Buffer.concat([sigwire, rrdata]), sig.data.signature];
}

function rawSignatureData(rrset, sig) {
  var encoded = rrset
    .map((r)=>{
      // https://tools.ietf.org/html/rfc4034#section-6
      // TODO (1, 3, 4)
      const r1 = Object.assign(r, {
        name: r.name.toLowerCase(), // (2)
        ttl: sig.data.originalTTL   // (5)
      });
      return packet.answer.encode(r1);
    }).sort((a,b)=>{
      return a.compare(b);
    })
    return Buffer.concat(encoded);
}


module.exports = {queryWithProof, pack, display}