const namehash = require('eth-ens-namehash');
const DnsProve = require('./../lib/dnsprover.js');
const DNSSEC = require('../build/contracts/DNSSEC.json');
const ENSImplementation = require('../build/contracts/ensimplementation.json');
const DNSRegistrar = require('../build/contracts/dnsregistrar.json');
const Web3 = require('web3');
const packet = require('dns-packet');

function hexEncodeName(name) {
  return '0x' + packet.name.encode(name).toString('hex');
}

function updateDOM(element, message, override) {
  if (override) {
    document.getElementById(element).innerHTML = message;
  } else {
    document.getElementById(element).innerHTML =
      document.getElementById(element).innerHTML + '\n' + message;
  }
}

function askOracle() {
  document.getElementById('oracle-output').innerHTML = '';
  let proofs = window.result.proofs;

  proofs.forEach(function(proof) {
    let rrdata;
    window.oracle.knownProof(proof).then(function(r) {
      updateDOM('oracle-output', proof.name + '\t' + proof.type + '\t' + r);
    });
  });
  let lastResult = window.result.results[window.result.results.length - 1];
  let owner = lastResult.rrs[0].data.toString().split('=')[1];
  updateDOM('oracle-output', 'The address is owned by ' + owner);
}

function askEns(input, cb) {
  window.ens.owner(namehash.hash(input), (error, r) => {
    cb(r);
  });
}

function claim(name, proof) {
  let encodedProof = '0x' + proof.rrdata.toString('hex');
  window.dnsregistrar.claim(
    hexEncodeName(name + '.'),
    encodedProof,
    { from: web3.eth.defaultAccount },
    (error, r) => {
      console.log('claimed', r);
    }
  );
}

document.addEventListener('DOMContentLoaded', function(event) {
  if (typeof web3 !== 'undefined') {
    // Use the browser's ethereum provider
    var provider = web3.currentProvider;
    console.log('Using metamask');
  } else {
    var provider = new Web3.providers.HttpProvider('http://localhost:8545');
    console.log('Using local provider');
  }

  // They are pre web3 1.0 syntax loaded via metamask
  web3.version.getNetwork((error, network) => {
    const oracleAddress = DNSSEC.networks[network].address;
    const oracleAbi = DNSSEC.abi;
    const ensAddress = ENSImplementation.networks[network].address;
    const ensAbi = ENSImplementation.abi;
    const dnsregistrarAddress = DNSRegistrar.networks[network].address;
    const dnsregistrarAbi = DNSRegistrar.abi;
    var OracleContract = web3.eth.contract(oracleAbi);
    var ENSContract = web3.eth.contract(ensAbi);
    var DNSRegistrarContract = web3.eth.contract(dnsregistrarAbi);
    window.ens = ENSContract.at(ensAddress);
    window.dnsregistrar = DNSRegistrarContract.at(dnsregistrarAddress);
    window.dnsprove = new DnsProve(provider);
    window.oracle = dnsprove.getOracle(oracleAddress);
    window.oldOracle = OracleContract.at(oracleAddress);
    window.ensEvents = ens.allEvents({ fromBlock: 0, toBlock: 'latest' });
    window.dnsregistrarEvents = dnsregistrar.allEvents({
      fromBlock: 0,
      toBlock: 'latest'
    });
    window.oracleEvents = oldOracle.allEvents({
      fromBlock: 0,
      toBlock: 'latest'
    });
  });

  document.getElementById('lookup-button').onclick = function() {
    document.getElementById('lookup-output').innerHTML = '';
    window.input = document.getElementById('lookup-input').value;
    document.getElementById('lookup-output').innerHTML = window.input;
    dnsprove.lookup('TXT', '_ens.' + window.input).then(function(r) {
      window.result = r;
      if (result.found) {
        document.getElementById('lookup-output').innerHTML = r
          .display()
          .map(c => {
            return c.join('\n');
          })
          .join('\n');
        askEns(window.input, r => {
          updateDOM(
            'ens-lookup-output',
            r || input + ' is not found on ENS',
            true
          );
        });
        askOracle();
      } else {
        document.getElementById('lookup-output').innerHTML =
          'the entry does not exist on DNS';
      }
    });
  };
  document.getElementById('submit-button').onclick = function() {
    updateDOM('oracle-output', '', true);
    if (!window.result) {
      updateDOM('oracle-output', 'Please lookup DNS first');
      return false;
    } else {
      window.oracle.submitOnce(window.result, { from: web3.eth.defaultAccount });
    }
  };
});
