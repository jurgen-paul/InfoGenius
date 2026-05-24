import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  collection, 
  query, 
  orderBy, 
  getDocFromServer,
  Timestamp,
  serverTimestamp
} from 'firebase/firestore';
import { GeneratedImage } from '../types';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firestore with custom Database ID
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId); /* CRITICAL: The app will break without this line */

// Initialize Authentication
export const auth = getAuth(app);

// Providers
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/presentations');
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');

// In-memory access token cache
let cachedGoogleAccessToken: string | null = null;

export function getGoogleAccessToken(): string | null {
  return cachedGoogleAccessToken;
}

export function setGoogleAccessToken(token: string | null) {
  cachedGoogleAccessToken = token;
}

// Operational Types as specified in the Firebase Skill Guide
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

// Global Custom Error Handler
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  
  console.error('Firestore Error details: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test Connection
export async function testConnection() {
  try {
    // Attempt standard read to confirm rules and network
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firebase connection response validated successfully.");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration: Client is offline.");
    } else {
      // It's fine if the document doesn't exist, we just want to ensure it has reached the server
      console.log("Firebase server reached safely.");
    }
  }
}

// Google Sign In
export async function signInWithGoogle(): Promise<User> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedGoogleAccessToken = credential.accessToken;
    }
    
    // Save/Update user profile record in Firestore
    const userRef = doc(db, 'users', result.user.uid);
    const path = `users/${result.user.uid}`;
    try {
      await setDoc(userRef, {
        email: result.user.email,
        displayName: result.user.displayName,
        photoURL: result.user.photoURL,
        createdAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      // Catch and handle
      handleFirestoreError(err, OperationType.WRITE, path);
    }
    
    return result.user;
  } catch (error) {
    console.error("Failed to sign in with Google:", error);
    throw error;
  }
}

// Logout
export async function logOutUser(): Promise<void> {
  try {
    await signOut(auth);
    cachedGoogleAccessToken = null;
  } catch (error) {
    console.error("Failed clear authentication state:", error);
    throw error;
  }
}

// Save Infographic to User Subcollection
export async function saveInfographicToDb(userId: string, image: GeneratedImage): Promise<void> {
  const path = `users/${userId}/infographics/${image.id}`;
  try {
    const docRef = doc(db, 'users', userId, 'infographics', image.id);
    await setDoc(docRef, {
      id: image.id,
      data: image.data,
      prompt: image.prompt,
      timestamp: image.timestamp,
      level: image.level || 'High School',
      style: image.style || 'Default',
      language: image.language || 'English',
      imagePrompt: image.imagePrompt || '',
      originalTopic: image.originalTopic || image.prompt,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// Load Infographics for Logged In User
export async function loadUserInfographics(userId: string): Promise<GeneratedImage[]> {
  const path = `users/${userId}/infographics`;
  try {
    const collRef = collection(db, 'users', userId, 'infographics');
    const q = query(collRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    
    const list: GeneratedImage[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      list.push({
        id: data.id,
        data: data.data,
        prompt: data.prompt,
        timestamp: data.timestamp,
        level: data.level,
        style: data.style,
        language: data.language,
        imagePrompt: data.imagePrompt,
        originalTopic: data.originalTopic
      });
    });
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

// Remove an infographic from user subcollection
export async function deleteInfographicFromDb(userId: string, infographicId: string): Promise<void> {
  const path = `users/${userId}/infographics/${infographicId}`;
  try {
    const docRef = doc(db, 'users', userId, 'infographics', infographicId);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
