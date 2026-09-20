const { instance } = require("../config/razorpay");
const Course = require("../models/Course");
const crypto = require("crypto");
const User = require("../models/User");
const mailSender = require("../utils/mailSender");
const mongoose = require("mongoose");
const { courseEnrollmentEmail } = require("../mail/templates/courseEnrollmentEmail");
const { paymentSuccessEmail } = require("../mail/templates/paymentSuccessEmail");
const CourseProgress = require("../models/CourseProgress");

// ------------------- CAPTURE PAYMENT -------------------
exports.capturePayment = async (req, res) => {
  const { courses } = req.body;
  const userId = req.user.id;

  if (!Array.isArray(courses) || courses.length === 0) {
    return res.status(400).json({ success: false, message: "Please provide at least one Course ID." });
  }

  let totalAmount = 0;

  for (const courseId of courses) {
    try {
      const course = await Course.findById(courseId);

      if (!course) {
        return res.status(404).json({ success: false, message: `Course not found: ${courseId}` });
      }

      const uid = new mongoose.Types.ObjectId(userId);

      // ✅ Safe check to avoid .includes crash
      if (Array.isArray(course.studentsEnroled) && course.studentsEnroled.includes(uid)) {
        return res.status(409).json({ success: false, message: `Already enrolled in ${course.courseName}` });
      }

      totalAmount += course.price;
    } catch (error) {
      console.error("Error during course validation:", error);
      return res.status(500).json({ success: false, message: "Server error during course validation" });
    }
  }

  try {
    const options = {
      amount: totalAmount * 100,
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    };

    const paymentResponse = await instance.orders.create(options);

    return res.status(200).json({
      success: true,
      data: paymentResponse,
    });
  } catch (error) {
    console.error("Razorpay Order Creation Error:", error);
    return res.status(500).json({ success: false, message: "Could not initiate Razorpay order." });
  }
};

// ------------------- VERIFY PAYMENT -------------------
exports.verifyPayment = async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    courses,
  } = req.body;

  const userId = req.user.id;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !Array.isArray(courses) || !userId) {
    return res.status(400).json({ success: false, message: "Missing payment details." });
  }

  const body = razorpay_order_id + "|" + razorpay_payment_id;

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_SECRET)
    .update(body)
    .digest("hex");

  if (expectedSignature === razorpay_signature) {
    await enrollStudents(courses, userId, res);
    return res.status(200).json({ success: true, message: "Payment Verified" });
  }

  return res.status(400).json({ success: false, message: "Payment verification failed" });
};

// ------------------- SEND PAYMENT SUCCESS EMAIL -------------------
exports.sendPaymentSuccessEmail = async (req, res) => {
  const { orderId, paymentId, amount } = req.body;
  const userId = req.user.id;

  if (!orderId || !paymentId || !amount || !userId) {
    return res.status(400).json({ success: false, message: "Please provide all required details" });
  }

  try {
    const enrolledStudent = await User.findById(userId);

    await mailSender(
      enrolledStudent.email,
      `Payment Received`,
      paymentSuccessEmail(
        `${enrolledStudent.firstName} ${enrolledStudent.lastName}`,
        amount / 100,
        orderId,
        paymentId
      )
    );

    return res.status(200).json({ success: true, message: "Email sent successfully" });
  } catch (error) {
    console.error("Error in sending payment email:", error);
    return res.status(500).json({ success: false, message: "Could not send payment email" });
  }
};

// ------------------- ENROLL STUDENTS -------------------
const enrollStudents = async (courses, userId, res) => {
  for (const courseId of courses) {
    try {
      const enrolledCourse = await Course.findOneAndUpdate(
        { _id: courseId },
        { $addToSet: { studentsEnrolled: userId } },  // ✅ Corrected field name
        { new: true }
      );

      if (!enrolledCourse) {
        return res.status(404).json({ success: false, error: `Course not found: ${courseId}` });
      }

      console.log("✅ Enrolled student list:", enrolledCourse.studentsEnrolled);

      const courseProgress = await CourseProgress.create({
        courseID: courseId,
        userId: userId,
        completedVideos: [],
      });

      const enrolledStudent = await User.findByIdAndUpdate(
        userId,
        {
          $addToSet: {
            courses: courseId,
            courseProgress: courseProgress._id,
          },
        },
        { new: true }
      );

      await mailSender(
        enrolledStudent.email,
        `Successfully Enrolled into ${enrolledCourse.courseName}`,
        courseEnrollmentEmail(
          enrolledCourse.courseName,
          `${enrolledStudent.firstName} ${enrolledStudent.lastName}`
        )
      );

      console.log(`✅ Enrolled into course: ${enrolledCourse.courseName}`);
    } catch (error) {
      console.error("❌ Enrollment error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
};


