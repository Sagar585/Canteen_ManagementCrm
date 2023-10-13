const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { check, validationResult } = require("express-validator");
const auth = require("../middleware/auth");
const User = require("../models/auth.models");
const { OAuth2Client } = require('google-auth-library')
const nodemailer = require('nodemailer');
const { google } = require("googleapis");
require('dotenv').config(); 
const router = express.Router();


// signup: POST (public)
router.post(
  "/signup",
  [
    check("name", "Name is required").not().isEmpty(),
    check("email", "Please include a valid email").isEmail(),
    check(
      "password",
      "Please enter a password with 6 or more characters"
    ).isLength({ min: 6 }),
    check("role", "Please select your role").not().isEmpty(),
    check("branch", "Please select your branch").not().isEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password, branch, role } = req.body;

    try {
      let user = await User.findOne({ email });

      // check if user already exists
      if (user) {
        return res
          .status(400)
          .json({ errors: [{ msg: "User already exists" }] });
      }

      // hashing passwords
      const salt = await bcrypt.genSalt(12);
      const encryptedpassword = await bcrypt.hash(password, salt);

      // make user account
      user = new User({
        name,
        email,
        password: encryptedpassword,
        branch,
        role,
        isAdmin: false,
      });
      await user.save();

      // jwt
      const payload = {
        user: {
          id: user.id,
        },
      };

      jwt.sign(payload, process.env.JWT_SECRET, (err, token) => {
        if (err) {
          throw err;
        }
        res.json({ token, user });
      });
    } catch (error) {
      console.log(error.message);
      res.status(500).send(error);
    }
  }
);

//signin: POST (public)
router.post(
  "/signin",
  [
    check("email", "Please include a valid email").isEmail(),
    check("password", "Password is required").not().isEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log(errors);
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      let user = await User.findOne({ email });

      if (!user) {
        return res
          .status(400)
          .json({ errors: [{ msg: "Email does not exist" }] });
      }

      // check password

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res
          .status(400)
          .json({ errors: [{ msg: "Invalid Credentials" }] });
      }

      // JWT Token

      const payload = {
        user: {
          id: user.id,
        },
      };

      jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: "5 days" },
        (err, token) => {
          if (err) throw err;
          res.json({ token });
        }
      );
    } catch (error) {
      console.log(error.message);
      res.status(500).send(error.message);
    }
  }
);

//get user: GET (private)

router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send(err.message);
  }
});


// CODE FOR SENDING MAIL TO THE USER
const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirect_uri = process.env.REDIRECT_URI;
const gmailUser = process.env.GMAIL_USER;
const Refresh_Token = process.env.REFRESH_TOKEN

const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri )
oAuth2Client.setCredentials({ refresh_token:Refresh_Token});

// Generate and send OTP to the user's email
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Check if the user with the given email exists
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Generate a random OTP
    const otp = Math.floor(100000 + Math.random() * 900000);
    const otpTimestamp = Date.now();

    // Store the OTP in the user's record
    user.otp = otp;
    user.otpTimestamp = otpTimestamp;
    await user.save();


    const accessToken = await oAuth2Client.getAccessToken();

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: gmailUser,
        clientId: client_id,
        clientSecret: client_secret,
        refreshToken: Refresh_Token,
        accessToken: accessToken,
      },
    });

    // Send the OTP to the user's email
    const mailOptions = {
      from: 'kjsitcanteen@gmail.com',
      to: email,
      subject: 'Reset Password OTP',
      text: `Your OTP is: ${otp}`,
    };

    transporter.sendMail(mailOptions, (error) => {
      if (error) {
        console.log('Error sending email: ' + error);
        return res.status(500).json({ message: 'Email sending failed' });
      } else {
        // console.log('Email sent: ' + info.response);
        res.json({ message: 'OTP sent to your email' });
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// Verify OTP and reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Find the user with the given email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }


    const currentTimestamp = Date.now();
    const timeDifference = currentTimestamp - otpTimestamp;
    const otpExpiration = 10 * 60 * 1000; // 10 minutes in milliseconds

    // Check if the provided OTP matches the stored OTP
    if (user.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }
    else if(timeDifference > otpExpiration){
      return res.status(400).json({message:'otp has expired!'})
    }

    // hashing passwords
    const salt = await bcrypt.genSalt(12);
    const encryptedpassword = await bcrypt.hash(newPassword, salt);
    user.password = encryptedpassword;

    // Clear the stored OTP
    user.otp = null;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});



module.exports = router;
