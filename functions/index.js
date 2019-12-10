const functions = require('firebase-functions');
const { Storage } = require('@google-cloud/storage');
const os = require('os');
const path = require('path');
const cors = require('cors')({ origin: true });
const Busboy = require('busboy');
const fs = require('fs');

const projectId = 'fyp-test-db';

const gcs = new Storage({
  projectId: projectId
});

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://fyp-test-db.firebaseio.com/'
});

exports.onFileChange = functions.storage
  .object()
  .onFinalize((object, context) => {
    const bucket = object.bucket;
    const contentType = object.contentType;
    const filePath = object.name;
    console.log('File change detected, funcion execution started');

    if (path.basename(filePath).startsWith('renamed-')) {
      console.log('Already renamed the file');
      console.log('content '+`${contentType}`);
      console.log('path '+`${filePath}`);
      return;
    }

    const destBucket = gcs.bucket(bucket);
    const tmpFilePath = path.join(os.tmpdir(), path.basename(filePath));
    const metadata = { contentType: contentType };

    return destBucket
      .file(filePath)
      .download({
        destination: tmpFilePath
      })
      .then(() => {
        return destBucket.upload(tmpFilePath, {
          destination: 'renamed-' + path.basename(filePath),
          metadata: metadata
        });
      });
  });

exports.onFileDelete = functions.storage.object().onDelete(event => {
  console.log(event);
  return;
});

exports.onDataAdded = functions.database
  .ref('/message/{id}')
  .onCreate((snap, context) => {
    const data = snap.val();
    const newData = {
      msg: snap.key + ' - ' + data.msg.toUpperCase()
    };
    console.log(snap.key);
    return snap.ref.parent.child('copiedData').set(newData);
  });





//////////////////////////   Posting Device Data   //////////////////////////////

const db = admin.database();
const ref = db.ref('deviceDataStore');


exports.connData = functions.https.onRequest((req, res) => {
  cors(req, res, () => {
    const usersRef = ref.child(`${req.body.deviceID}`);

    if (req.method !== 'POST') {
      return res.status(500).json({
        message: 'Not allowed'
      });
    } else {
      return usersRef
        .set(req.body)
        .then(() => {
          res.status(200).json({
            message: req.body
          });
          return res.status(200);
        })
        .catch(error => {
          return res.status(500).send(error);
        });
    }
  });
});





////////////////////////////  Posting File Data Store  /////////////////////////////////////////////



exports.fileData = functions.https.onRequest((req, res) => {
  cors(req, res, () => {
    const fileRef = admin.database().ref('fileStoreDetails').child(`${req.body.fileName}`);

    if (req.method !== 'POST') {
      return res.status(500).json({
        message: 'Not allowed'
      });

    } else {
      return fileRef
        .set(req.body)
        .then(() => {
          res.status(200).json({
            message: req.body
          });
          return res.status(200);
        })
        .catch(error => {
          return res.status(500).send(error);
        });
    }
  });
});



/////////////////////////////// Cloud Messagging//////////////////////////////////////////////////////////

exports.sendAdminNotification = functions.database
  .ref('/News/{pushId}')
  .onCreate((snap, context) => {
    const news = snap.val();
    if (news.priority === 1) {
      const payload = {
        notification: {
          title: 'New news',
          body: `${news.title}`
        },
        data: {
            device1ID: `${news.device1ID}`,
            device1SSID: `${news.device1SSID}`,
            device2ID: `${news.device2ID}`,
            device2SSID: `${news.device2SSID}`,
            fileName: `${news.fileName}`
        }
      };

      return admin
        .messaging()
        .sendToTopic('News', payload)
        .then(function(response) {
          console.log('Notification sent successfully:', response);
        })
        .catch(function(error) {
          console.log('Notification sent failed:', error);
        });
    }
  });



//////////////   Select Optimum Devices from DB  ////////////////////////

exports.optimumDevices = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {

        return res.status(500).json({
            message: 'Not allowed'
         });

      /*const value = await getDeviceParameters(req.query.id); 
      return res.status(200).json({
        message: value
      });*/

      
    } else {
      
      const query = admin
        .database()
        .ref('/deviceDataStore/')
        .orderByChild('batteryLevel')
        .limitToLast(2);

      query.once('value', function(snapshot) {
        var twoDevices = [];
        snapshot.forEach(function(childSnapshot) {
          //var childKey = childSnapshot.key;
          var childData = childSnapshot.child('deviceID').val();
          var childSSID =  childSnapshot.child('deviceSSIDName').val();

          twoDevices.push(childData);
          twoDevices.push(childSSID);

          console.log(twoDevices);

          admin
            .database()
            .ref('/News/newsid2')
            .update({
              description: 'Test description',
              device1ID : `${twoDevices[0]}`,
              device1SSID :`${twoDevices[1]}`,
              device2ID : `${twoDevices[2]}`,
              device2SSID : `${twoDevices[3]}`,
              fileName : "file001",
              priority : 1,
              title : "Test tiltle"
            });

        });
        return res.status(200).json({
          pairingdevices: twoDevices
        });
      });
    }
  });
});





/**
 *
 * @param {string} deviceID
 */

const getDeviceParameters = async deviceID => {
  const deviceRef = admin.database().ref(`/deviceDataStore/${deviceID}`);
  const snapshot = await deviceRef.once('value');

  if (snapshot.hasChildren()) {
    return snapshot.val();
  } else {
    console.log('device not found');
  }
};

// async function getDeviceParameters(deviceID) {
//   const deviceRef = admin.database().ref(`/deviceDataStore/${deviceID}`);
//   const snapshot = await deviceRef.once('value');

//   if (snapshot.hasChildren()) {
//     return snapshot.val();
//   } else {
//     console.log('device not found');
//   }
// }

