const functions = require('firebase-functions');
const { Storage } = require('@google-cloud/storage');
const os = require('os');
const path = require('path');
const cors = require('cors')({ origin: true });
const Busboy = require('busboy');
const fs = require('fs');
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
      URL : "gs://fyp-test-db.appspot.com/"+`${filePath}`,
      availableDeviceIDs : null,
      fileName : `${object.name}`,
      format : `${contentType}`,
      size : `${((object.size)/1024).toFixed(2)}`+" KB"
      });
  });


////////////////////////// Delete the file from DB ////////////////////////////////////////////////////////

exports.onFileDelete = functions.storage.object().onDelete(object => {
    const filePath = object.name;

    console.log('File delete detected, funcion execution started');
    const childFilePath = `${filePath}`.split('.')[0];
    const fileRef = admin.database().ref('fileStoreDetails').child(`${childFilePath}`);
    fileRef.remove();
  return console.log(`${childFilePath}`+" is removed from Filestore!")
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





//////////////////////////   API END POINT 1 - Posting Device Data   //////////////////////////////

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





////////////////////////////  API END POINT 2 - Posting File Data Store  /////////////////////////////////////////////



exports.fileData = functions.https.onRequest((req, res) => {
  cors(req, res, async()=> {

    await clearDeviceDataBase(`${req.body.deviceID}`)         //Clearing the DataBase under the required device
    
    const fileStoreRef = admin.database().ref('fileStoreDetails');
    
    if (req.method !== 'POST') {
      return res.status(500).json({
        message: 'Not allowed'
      }); 
    }
    
    else {


      const availableFiles = req.body.fileName;

      for(let file of availableFiles){
      
      fileStoreRef.once('value', function(snapshot) {
   
        var foundOne = snapshot.forEach(function (childSnapshot) {
            if (childSnapshot.key == file) {
                return true; 
             }
             else{return false};
            });


          if (!foundOne) {
            console.log(file, " Can't add to the DB! Upload the file to the Filestore first!")
          }

          else{
           console.log(file," Approved!");
           var fileRef = admin.database().ref('fileStoreDetails/'+ file).child('availableDeviceIDs');
           var deviceJson = {};
           deviceJson[req.body.deviceID] = `${req.body.deviceID}`
           fileRef.update(deviceJson); 
          };
     
        
      });
    };

    
    return res.status(200).json({
      message : "Only files in the Filestore is approved. Check the log for the approved files."
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



//////////////   API END POINT -3 Select Optimum Devices from DB  ////////////////////////

exports.optimumDevices = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {

        return res.status(500).json({
            message: 'Not allowed'
         });

    
      
    } else {

      const fileStoreRef = admin.database().ref('/fileStoreDetails/'+`${req.body.fileName}`);
      const fileSnapshot = await fileStoreRef.once('value');

      
      if(!fileSnapshot.hasChild('availableDeviceIDs')){
        console.log('Do not have a device!');
        return res.status(200).json({
          download : 1,
          URL : `${fileSnapshot.child('URL').val()}`
        })

      }

      else{
        
      const deviecStore = admin.database().ref('/deviceDataStore/');

      var hasFile = [];                                                                 //file containing devices
      fileSnapshot.child('availableDeviceIDs').forEach(function(childSnapshot){
        hasFile.push(childSnapshot.key);
      })

  
       deviecStore.on('value',function(snapshot){

        var requestingDeviceRssi = snapshot.child(`${req.body.deviceID}`).child('connRSSI').val();
        var deviceScore = {};


        snapshot.forEach(function(childSnapshot){
          
          if(hasFile.includes(childSnapshot.key)){
            var rssiScore = Math.abs((Number(childSnapshot.child('connRSSI').val()) - Number(requestingDeviceRssi)));
            var finalScore = ((100-rssiScore) + 0.01*Number(childSnapshot.child('batteryLevel').val())+Number(childSnapshot.child('linkSpeed').val()))
                            .toFixed(2);

            deviceScore[childSnapshot.key]=finalScore;
          };
        });


        console.log(deviceScore);

        var pairDevice = _.max(Object.keys(deviceScore), o => deviceScore[o]);     //getting the highest score device

        
        var requestingDeviceSSID = snapshot.child(`${req.body.deviceID}`).child('deviceSSIDName').val();
        var pairDeviceSSID = snapshot.child(`${pairDevice}`).child('deviceSSIDName').val();

        admin
            .database()
            .ref('/News/newsid2')
            .update({
              description: 'Test description',
              device1ID : `${req.body.deviceID}`,
              device1SSID :`${requestingDeviceSSID}`,
              device2ID : `${pairDevice}`,
              device2SSID : `${pairDeviceSSID}`,
              fileName : `${req.body.fileName}`,
              priority : 1,
              title : "Test tiltle"
            });


        return res.status(200).json({
          download : 0,
          URL : null,
          pairDevice : `${pairDevice}`
        });
      });
    }


    }
  });
});







 async function clearDeviceDataBase(deviceID){
  const fileRef = admin.database().ref('fileStoreDetails');;
  const snapshot = await fileRef.once('value');


  snapshot.forEach(function(childSnapshot){
    childSnapshot.child('availableDeviceIDs').child(`${deviceID}`).ref.remove();
  });

};

