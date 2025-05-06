/*!
* Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
*/
export const mockData = {};

/* eslint-disable */
mockData.verifiableCredential = {
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://w3id.org/vc-barcodes/v1",
    "https://w3id.org/utopia/v2"
  ],
  "type": [
    "VerifiableCredential",
    "OpticalBarcodeCredential"
  ],
  "credentialSubject": {
    "type": "MachineReadableZone"
  },
  "issuer": "did:key:zDnaeZSD9XcuULaS8qmgDUa6TMg2QjF9xABnZK42awDH3BEzj",
  "proof": {
    "type": "DataIntegrityProof",
    "verificationMethod": "did:key:zDnaeZSD9XcuULaS8qmgDUa6TMg2QjF9xABnZK42awDH3BEzj#zDnaeZSD9XcuULaS8qmgDUa6TMg2QjF9xABnZK42awDH3BEzj",
    "cryptosuite": "ecdsa-xi-2023",
    "proofPurpose": "assertionMethod",
    "proofValue": "z4B8AQgjwgsEdcPEZkrkK2mTVKn7qufoDgDkv9Qitf9tjxQPMoJaGdXwDrThjp7LUdvzsDJ7UwYu6Xpm9fjbo6QnJ"
  }
};
/* eslint-enable */

/* eslint-disable */
mockData.vcbText = 'VC1-RSJRPWCR803A3P0098G3A3-B02-J743853U53KGK0XJ6MKJ1OI0M.FO053.33963DN04$RAQS+4SMC8C3KM7VX4VAPL9%EILI:I1O$D:23%GJ0OUCPS0H8D2FB9D5G00U39.PXG49%SOGGB*K$Z6%GUSCLWEJ8%B95MOD0P NG-I:V8N63K53';
/* eslint-enable */
