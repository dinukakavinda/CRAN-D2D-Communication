const functions = require('firebase-functions');
const { Storage } = require('@google-cloud/storage');
const cors = require('cors')({ origin: true });
const _ = require('underscore');

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


///////////////////// Create DB fileStoreDetails when file is uploaded ////////////////////////////////

exports.onFileChange = functions.storage
  .object()
  .onFinalize((object, context) => {

    const contentType = object.contentType;
    const filePath = object.name;

    console.log('File change detected, funcion execution started');

    const childFilePath = `${filePath}`.split('.')[0];
    const fileRef = admin.database().ref('fileStoreDetails').child(`${childFilePath}`);

    return fileRef.set({
      URL: "gs://fyp-test-db.appspot.com/" + `${filePath}`,
      availableDeviceIDs: null,
      fileName: `${object.name}`,
      format: `${contentType}`,
      size: `${((object.size) / 1024).toFixed(2)}` + " KB"
    });
  });

////////////////////////// Delete the file from DB ////////////////////////////////////////////////////////

exports.onFileDelete = functions.storage.object().onDelete(object => {
  const filePath = object.name;

  console.log('File delete detected, funcion execution started');
  const childFilePath = `${filePath}`.split('.')[0];
  const fileRef = admin.database().ref('fileStoreDetails').child(`${childFilePath}`);
  fileRef.remove();
  return console.log(`${childFilePath}` + " is removed from Filestore!")
});



//////////////////////////   API END POINT 1 - Posting Device Data   //////////////////////////////

const db = admin.database();
const ref = db.ref('deviceDataStore');

exports.connData = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    const usersRef = ref.child(`${req.body.deviceID}`);

    if (req.method !== 'POST') {
      return res.status(500).json({
        message: 'Not allowed'
      });
    } else {
      return usersRef
        .update(req.body)
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

////////////////////////////  API END POINT 2 - Posting File Data Store  /////////////////////////////////////////////

exports.connFileUpdate = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {

    await clearDeviceDataBase(`${req.body.deviceID}`)         //Clearing the DataBase under the required device

    const fileStoreRef = admin.database().ref('fileStoreDetails');

    if (req.method !== 'POST') {
      return res.status(500).json({
        message: 'Not allowed'
      });
    } else {
      var availableFiles = `${req.body.fileList}`;
      availableFiles = availableFiles.replace('[', '')
      availableFiles = availableFiles.replace(']', '')
      availableFiles = availableFiles.split(",")

      for (let file of availableFiles) {

        fileStoreRef.once('value', function (snapshot) {
          var foundOne = snapshot.forEach(function (childSnapshot) {
            file = `${file}`.split('.')[0].trim()
            var fileNameTemp = String(childSnapshot.key).trim()

            if (fileNameTemp === file) {
              return true;
            } else {
              return false
            }
          });

          if (!foundOne) {
            console.log(file, " Can't add to the DB! Upload the file to the Filestore first!")
          } else {
            console.log(file, " Approved!");
            var fileRef = admin.database().ref('fileStoreDetails/' + file).child('availableDeviceIDs');
            var deviceJson = {};
            deviceJson[req.body.deviceID] = `${req.body.deviceID}`
            fileRef.update(deviceJson);
          }
        });
      }

      return res.status(200).json({
        message: "Only files in the Filestore is approved. Check the log for the approved files."
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
        .then(function (response) {
          console.log('Notification sent successfully:', response);
          return null
        })
        .catch(function (error) {
          console.log('Notification sent failed:', error);
        });
    }
  });

//////////////   API END POINT -3 Select Optimum Devices from DB  ////////////////////////

exports.connFileRequest = functions.https.onRequest((req, res) => {
  console.log("connFileRequest function executed")
  cors(req, res, async () => {
    if (req.method !== 'POST') {

      return res.status(500).json({
        message: 'Not allowed'
      });
    } else {

      const fileStoreRef = admin.database().ref('/fileStoreDetails/' + `${req.body.fileName}`);
      const fileSnapshot =  await fileStoreRef.once('value');      //await

      if (!fileSnapshot.hasChild('availableDeviceIDs')) {
        console.log('Do not have a device!');
        return res.status(200).json({
          download: 1,
          URL: `${fileSnapshot.child('URL').val()}`,
          fileName : `${fileSnapshot.child('fileName').val()}`
        })
      } else {

        const deviecStore = admin.database().ref('/deviceDataStore/');

        //building file available deviceID list
        var hasFile = [];
                                                                       //file containing devices
        fileSnapshot.child('availableDeviceIDs').forEach(function (childSnapshot) {
          let batteryLevel = 0;
          //getting the battery level of device
          deviecStore.on('value', function (snapshotOne) {
            batteryLevel = Number(snapshotOne.child(`${childSnapshot.key}`).child('batteryLevel').val());
            //console.log('1 id:'+childSnapshot.key)
            //console.log('2 battery :'+batteryLevel.toString());
            //consider the battery level
            if ((childSnapshot.key !== req.body.deviceID) && (batteryLevel > 5)) {
              //console.log('3 inside:'+childSnapshot.key)
              hasFile.push(childSnapshot.key);
            }
            //console.log('inside hasFile list :' + hasFile.toString());
            
          }
          );
         
          //console.log('outside hasFile list :' + hasFile.toString());
        })

        deviecStore.on('value', function (snapshot) {

          //declaring constants
          var a_1 = -2.153;
          //var a_2 = -2.493;
          var a_3 = -2.952;
          var b_1 = -34.54;
          //var b_2 = -38.85;
          var b_3 = -41.31+15;
          //var p = -53.83
          var rssi_1 = -1 * Number(snapshot.child(`${req.body.deviceID}`).child('connRSSI').val());
          var deviceScore = {};
          var r_1 = 0;
          var r_1_db = 0;

          //finding r_1
          r_1_db = (rssi_1 - b_1) / a_1;
         

          r_1 = Math.pow(10, r_1_db * 0.1);

          //finding threshold r
          var r_th_db = (rssi_1 - b_3) / a_3;
          var r_th = Math.pow(10, r_th_db * 0.1)

          //calculate r_i and prob_i
          snapshot.forEach(function (childSnapshot) {
            //iterating over deviceIDs
            if (hasFile.includes(childSnapshot.key)) {
              var rssi_i = -1 * Number(childSnapshot.child('connRSSI').val());

              //finding r_i
              var r_i = 0;
              var r_i_db = 0;

              r_i_db = (rssi_i - b_1) / a_1;

              r_i = Math.pow(10, r_i_db * 0.1);

               //limiting r_th3

              //r_th_limit = Math.max(Math.min(r_th,(r_1+r_i)),Math.abs(r_1-r_i));
              acos_val = ((Math.pow(r_1, 2) + Math.pow(r_i, 2) - Math.pow(r_th, 2)) / (2 * r_1 * r_i));

              acos_val_limit = Math.max(Math.min(acos_val,1),-1);

              //finding prob_i
              var prob_i = Math.acos(acos_val_limit) / Math.PI;

              deviceScore[childSnapshot.key] = prob_i
            }
          });

          //get the deviceID with maximum score
          var pairDevice = _.max(Object.keys(deviceScore), o => deviceScore[o]);     //getting the highest score device
          
          
          console.log(deviceScore[pairDevice],r_th,r_1,acos_val);

          if (deviceScore[pairDevice]==0) {
            console.log('Prbability is zero for the value! Downloading from the internet');
            return res.status(200).json({
              download: 1,
              URL: `${fileSnapshot.child('URL').val()}`,
              fileName : `${fileSnapshot.child('fileName').val()}`
            })
          };

          
          //getting the device names to d2d link connection and file name
          var requestingDeviceSSID = snapshot.child(`${req.body.deviceID}`).child('deviceSSIDName').val();
          var pairDeviceSSID = snapshot.child(`${pairDevice}`).child('deviceSSIDName').val();
          var fileNameString = fileSnapshot.child('fileName').val();

          admin
            .database()
            .ref('/News')
            .push({
              description: 'Test description',
              device1ID: `${req.body.deviceID}`,
              device1SSID: `${requestingDeviceSSID}`,
              device2ID: `${pairDevice}`,
              device2SSID: `${pairDeviceSSID}`,
              fileName: fileNameString,
              priority: 1,
              title: "Test Title"
            });
          return res.status(200).json({
            download: 0,
            URL: null,
            pairDevice: `${pairDevice}`
          });
        });
      }
    }
  });
});

async function clearDeviceDataBase(deviceID) {
  const fileRef = admin.database().ref('fileStoreDetails');
  const snapshot = await fileRef.once('value');

  snapshot.forEach(function (childSnapshot) {
    childSnapshot.child('availableDeviceIDs').child(`${deviceID}`).ref.remove();
  });
}

